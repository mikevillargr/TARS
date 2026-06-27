"""
WebSocket bridge for Rokid glasses.
GET /api/rokid/ws?token=<jwt>

Proxies TARS chat (SSE) to the clawsses phone↔glasses streaming protocol,
so the TARS Android companion app can drive Rokid glasses as a streaming HUD.

Phone → Harness (glasses input relayed via phone):
  {"type": "user_input",     "text": "...", "imageBase64": "..."}
  {"type": "list_sessions"}
  {"type": "switch_session", "sessionKey": "<conv_id>"}
  {"type": "create_session"}
  {"type": "wake_ack",       "ready": true}

Harness → Phone (relayed to glasses HUD):
  {"type": "connection_update", "connected": bool, "sessionId": "...", "sessionName": "..."}
  {"type": "session_list",      "sessions": [...], "currentSessionKey": "..."}
  {"type": "chat_message",      "id": "...", "role": "user|assistant", "content": "...", "timestamp": ms}
  {"type": "agent_thinking",    "id": "..."}
  {"type": "chat_stream",       "id": "...", "role": "assistant", "chunk": "..."}
  {"type": "chat_stream_end",   "id": "..."}
  {"type": "wake_signal",       "reason": "...", "bufferedCount": n}
"""

import asyncio
import json
import logging
import uuid
from typing import Optional

import httpx
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select, desc
from starlette.websockets import WebSocketState

from core.auth import verify_ws_token
from db.session import AsyncSessionLocal
from db.models import Conversation, Message

log = logging.getLogger(__name__)
router = APIRouter()

# Internal harness base — always localhost since we're in the same process
_HARNESS_BASE = "http://localhost:8000"


@router.websocket("/ws")
async def rokid_ws(
    websocket: WebSocket,
    token: str = Query(...),
):
    user_id = verify_ws_token(token)
    if not user_id:
        await websocket.close(code=4401)
        return

    await websocket.accept()

    current_conv_id: Optional[str] = None
    active_stream_task: Optional[asyncio.Task] = None
    _active_tasks: set = set()

    async def send(msg: dict) -> None:
        if websocket.client_state == WebSocketState.CONNECTED:
            try:
                await websocket.send_json(msg)
            except Exception:
                pass

    async def _list_convs() -> list:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Conversation)
                .where(Conversation.user_id == user_id)
                .order_by(desc(Conversation.created_at))
                .limit(20)
            )
            return result.scalars().all()

    async def _ensure_conv() -> str:
        nonlocal current_conv_id
        if current_conv_id:
            return current_conv_id
        convs = await _list_convs()
        if convs:
            current_conv_id = convs[0].id
        else:
            current_conv_id = await _new_conv()
        return current_conv_id

    async def _new_conv() -> str:
        nonlocal current_conv_id
        async with AsyncSessionLocal() as db:
            conv = Conversation(
                id=str(uuid.uuid4()),
                user_id=user_id,
                title=None,
            )
            db.add(conv)
            await db.commit()
            current_conv_id = conv.id
            return conv.id

    async def _send_history(conv_id: str) -> None:
        """Load a conversation's recent messages and replace the HUD view with them."""
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Message)
                .where(Message.conversation_id == conv_id)
                .order_by(Message.created_at)
                .limit(40)
            )
            rows = result.scalars().all()
        await send({
            "type": "chat_history",
            "messages": [
                {
                    "id": m.id,
                    "role": m.role,
                    "content": (m.content or ""),
                    "timestamp": int(m.created_at.timestamp() * 1000) if m.created_at else 0,
                }
                for m in rows
                if m.role in ("user", "assistant") and (m.content or "").strip()
            ],
            "isLoadMore": False,
            "hasMore": False,
        })

    async def _conv_name(conv_id: str) -> str:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Conversation).where(Conversation.id == conv_id))
            conv = result.scalar_one_or_none()
            return (conv.title if conv and conv.title else "TARS")

    def _session_list_payload(convs: list, current_id: Optional[str]) -> dict:
        return {
            "type": "session_list",
            "sessions": [
                {
                    "key": c.id,
                    "label": (c.title or "Untitled conversation")[:40],
                    "updatedAt": int(c.created_at.timestamp() * 1000) if c.created_at else 0,
                }
                for c in convs
            ],
            "currentSessionKey": current_id,
            "unreadSessionKeys": [],
        }

    # ── Initial handshake ─────────────────────────────────────────────────────
    try:
        conv_id = await _ensure_conv()
        convs = await _list_convs()
        name = await _conv_name(conv_id)

        await send({"type": "connection_update", "connected": True, "sessionId": conv_id, "sessionName": name})
        await send(_session_list_payload(convs, conv_id))

        # ── Message loop ─────────────────────────────────────────────────────
        while websocket.client_state == WebSocketState.CONNECTED:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                await send({"type": "ping"})
                continue
            except (RuntimeError, WebSocketDisconnect):
                break

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            mtype = msg.get("type")

            if mtype == "user_input":
                text = (msg.get("text") or "").strip()
                image_b64 = msg.get("imageBase64")
                if not text and not image_b64:
                    continue

                conv_id = await _ensure_conv()
                user_msg_id = str(uuid.uuid4())
                assistant_msg_id = str(uuid.uuid4())

                # Echo user turn to HUD
                await send({
                    "type": "chat_message",
                    "id": user_msg_id,
                    "role": "user",
                    "content": text or "[Photo]",
                    "timestamp": _now_ms(),
                })

                # Thinking indicator before stream starts
                await send({"type": "agent_thinking", "id": assistant_msg_id})

                # Cancel previous in-flight stream if any
                if active_stream_task and not active_stream_task.done():
                    active_stream_task.cancel()

                active_stream_task = asyncio.create_task(
                    _stream_to_glasses(
                        token=token,
                        conv_id=conv_id,
                        text=text,
                        image_b64=image_b64,
                        msg_id=assistant_msg_id,
                        send_fn=send,
                    )
                )
                _active_tasks.add(active_stream_task)
                active_stream_task.add_done_callback(_active_tasks.discard)

            elif mtype == "list_sessions":
                convs = await _list_convs()
                await send(_session_list_payload(convs, current_conv_id))

            elif mtype == "switch_session":
                session_key = msg.get("sessionKey")
                if session_key:
                    current_conv_id = session_key
                    # Cancel any in-flight stream from the previous session
                    if active_stream_task and not active_stream_task.done():
                        active_stream_task.cancel()
                    name = await _conv_name(session_key)
                    await send({
                        "type": "connection_update",
                        "connected": True,
                        "sessionId": session_key,
                        "sessionName": name,
                    })
                    # Replace the HUD view with the switched conversation's history
                    await _send_history(session_key)

            elif mtype == "create_session":
                if active_stream_task and not active_stream_task.done():
                    active_stream_task.cancel()
                new_id = await _new_conv()
                await send({
                    "type": "connection_update",
                    "connected": True,
                    "sessionId": new_id,
                    "sessionName": "New conversation",
                })
                # Fresh conversation — clear the HUD view
                await send({"type": "chat_history", "messages": [], "isLoadMore": False, "hasMore": False})

    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("Rokid WS error")
    finally:
        for t in list(_active_tasks):
            if not t.done():
                t.cancel()


async def _stream_to_glasses(
    token: str,
    conv_id: str,
    text: str,
    image_b64: Optional[str],
    msg_id: str,
    send_fn,
) -> None:
    """
    Calls the TARS SSE chat endpoint and relays streaming events to the
    glasses in the clawsses phone↔glasses wire format.

    SSE event types handled:
      chunk   → chat_stream
      done    → chat_stream_end + final chat_message
      error   → error chunk + chat_stream_end
      tool_call → brief [tool…] inline annotation on HUD
    """
    # The chat endpoint expects the user text in the "content" form field.
    form_data = {"content": text or " "}
    if image_b64:
        form_data["image_base64"] = image_b64

    full_content = ""

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)) as client:
            async with client.stream(
                "POST",
                f"{_HARNESS_BASE}/api/chat/conversations/{conv_id}/messages",
                headers={"Authorization": f"Bearer {token}"},
                data=form_data,
            ) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    log.warning("Rokid: chat endpoint returned %s: %s", resp.status_code, body[:200])
                    await send_fn({
                        "type": "chat_stream",
                        "id": msg_id,
                        "role": "assistant",
                        "chunk": "[TARS: failed to process request]",
                    })
                    await send_fn({"type": "chat_stream_end", "id": msg_id})
                    return

                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if not raw:
                        continue
                    try:
                        event = json.loads(raw)
                    except json.JSONDecodeError:
                        continue

                    ev_type = event.get("type")

                    if ev_type == "chunk":
                        # The chat endpoint emits chunk text in the "text" field.
                        chunk = event.get("text") or event.get("content", "")
                        if chunk:
                            full_content += chunk
                            await send_fn({
                                "type": "chat_stream",
                                "id": msg_id,
                                "role": "assistant",
                                "chunk": chunk,
                            })

                    elif ev_type == "tool_call":
                        name = event.get("name", "")
                        # Show a brief inline tool annotation on the HUD
                        label = _tool_label(name)
                        if label:
                            await send_fn({
                                "type": "chat_stream",
                                "id": msg_id,
                                "role": "assistant",
                                "chunk": f"\n{label}\n",
                            })

                    elif ev_type in _CONFIRMABLE_CARDS:
                        # Interactive card needing user confirmation — forward the
                        # full payload; the glasses HUD shows a Confirm/Dismiss
                        # overlay and the phone executes the matching REST call.
                        await send_fn({"type": "card", "card": event})

                    elif ev_type in _DISPLAY_CARDS:
                        # Display-only cards: inline one-line summary (never
                        # forward heavy payloads like chart base64 to the HUD).
                        summary = _card_summary(event)
                        if summary:
                            await send_fn({
                                "type": "chat_stream",
                                "id": msg_id,
                                "role": "assistant",
                                "chunk": f"\n{summary}\n",
                            })

                    elif ev_type == "done":
                        await send_fn({"type": "chat_stream_end", "id": msg_id})
                        # Prefer streamed text; fall back to the full content on the done event.
                        final = full_content or event.get("content", "")
                        if final:
                            await send_fn({
                                "type": "chat_message",
                                "id": msg_id,
                                "role": "assistant",
                                "content": final,
                                "timestamp": _now_ms(),
                            })
                        # Auto-save any glasses photo to Artifacts (fire-and-forget)
                        if image_b64:
                            asyncio.create_task(_save_glasses_photo(token, image_b64))
                        return

                    elif ev_type == "error":
                        err = event.get("error", "unknown error")
                        await send_fn({
                            "type": "chat_stream",
                            "id": msg_id,
                            "role": "assistant",
                            "chunk": f"[Error: {err}]",
                        })
                        await send_fn({"type": "chat_stream_end", "id": msg_id})
                        return

    except asyncio.CancelledError:
        await send_fn({"type": "chat_stream_end", "id": msg_id})
    except Exception as exc:
        log.exception("Rokid stream error")
        try:
            await send_fn({
                "type": "chat_stream",
                "id": msg_id,
                "role": "assistant",
                "chunk": f"[Stream error: {exc}]",
            })
            await send_fn({"type": "chat_stream_end", "id": msg_id})
        except Exception:
            pass


def _now_ms() -> int:
    import time
    return int(time.time() * 1000)


async def _save_glasses_photo(token: str, image_b64: str) -> None:
    """Auto-save a glasses-captured photo to the Artifacts library."""
    from datetime import datetime as _dt
    ts = _dt.now().strftime("%Y%m%d_%H%M%S")
    filename = f"glasses_{ts}.jpg"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as _c:
            r = await _c.post(
                f"{_HARNESS_BASE}/api/artifacts",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "filename": filename,
                    "type": "image",
                    "source": "upload",
                    "content": f"base64:{image_b64}",
                    "tags": ["glasses", "photo"],
                },
            )
            if r.status_code in (200, 201):
                log.info("Glasses photo saved to artifacts: %s", filename)
            else:
                log.warning("Glasses photo artifact save failed (%s): %s", r.status_code, r.text[:200])
    except Exception as exc:
        log.warning("Failed to save glasses photo to artifacts: %s", exc)


_TOOL_LABELS = {
    "web_search": "[Searching…]",
    "read_email": "[Reading email…]",
    "send_email": "[Sending email…]",
    "create_task": "[Creating task…]",
    "propose_task": "[Creating task…]",
    "create_calendar_event": "[Adding to calendar…]",
    "propose_calendar_event": "[Checking calendar…]",
    "update_calendar_event": "[Updating event…]",
    "delete_calendar_event": "[Removing event…]",
    "save_memory": "[Saving to memory…]",
    "save_to_second_brain": "[Saving to Second Brain…]",
    "read_meeting": "[Reading meeting…]",
    "sync_meetings": "[Syncing meetings…]",
    "generate_document": "[Generating document…]",
    "lookup_contact": "[Looking up contact…]",
    "search_places": "[Searching places…]",
    "get_strava_activities": "[Fetching Strava…]",
    "get_tesla_status": "[Checking Tesla…]",
    "tesla_command": "[Sending Tesla command…]",
}


def _tool_label(tool_name: str) -> str:
    return _TOOL_LABELS.get(tool_name, f"[{tool_name}…]")


# Cards the HUD can confirm via gesture (phone executes the REST call).
_CONFIRMABLE_CARDS = {"email_draft", "calendar_suggest", "task_suggest"}

# Cards summarized inline on the HUD (no interaction; heavy payloads stripped).
_DISPLAY_CARDS = {
    "contact_card", "place_card", "artifact_created",
    "chart_image", "search_images",
}


def _card_summary(event: dict) -> str:
    t = event.get("type")
    try:
        if t == "contact_card":
            names = [c.get("display_name", "?") for c in event.get("contacts", [])[:3]]
            return f"[Contact: {', '.join(names)}]" if names else ""
        if t == "place_card":
            names = [p.get("name", "?") for p in event.get("places", [])[:3]]
            return f"[Places: {', '.join(names)}]" if names else ""
        if t == "artifact_created":
            return f"[Created: {event.get('filename', 'document')}]"
        if t == "chart_image":
            return f"[Chart: {event.get('title') or 'generated'} — view in TARS app]"
        if t == "search_images":
            return f"[Images found for '{event.get('query', '')}' — view in TARS app]"
    except Exception:
        pass
    return ""
