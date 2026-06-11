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
from db.models import Conversation

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
                    name = await _conv_name(session_key)
                    await send({
                        "type": "connection_update",
                        "connected": True,
                        "sessionId": session_key,
                        "sessionName": name,
                    })

            elif mtype == "create_session":
                new_id = await _new_conv()
                await send({
                    "type": "connection_update",
                    "connected": True,
                    "sessionId": new_id,
                    "sessionName": "New conversation",
                })
                convs = await _list_convs()
                await send(_session_list_payload(convs, new_id))

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
    form_data = {"message": text or " "}
    if image_b64:
        form_data["image_base64"] = image_b64

    full_content = ""

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)) as client:
            async with client.stream(
                "POST",
                f"{_HARNESS_BASE}/api/chat/{conv_id}/messages",
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
                        chunk = event.get("content", "")
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

                    elif ev_type == "done":
                        await send_fn({"type": "chat_stream_end", "id": msg_id})
                        if full_content:
                            await send_fn({
                                "type": "chat_message",
                                "id": msg_id,
                                "role": "assistant",
                                "content": full_content,
                                "timestamp": _now_ms(),
                            })
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
