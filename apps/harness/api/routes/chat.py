import asyncio
import base64
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import json as _json
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, desc, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

from core.auth import require_auth
from core.router import classify
from core.model_client import get_model_client, ModelClient, ModelTier, PROPOSE_CALENDAR_EVENT_TOOL, PROPOSE_TASK_TOOL, CREATE_TASK_TOOL, CREATE_CALENDAR_EVENT_TOOL
from core.context_assembler import assemble
from core.streaming import sse_event, sse_done
from db.session import get_db, AsyncSessionLocal
from db.models import Conversation, Message, User, Task

router = APIRouter()

# Strong references so background tasks aren't GC'd before they finish
_active_bg_tasks: set = set()


# ── Schemas ───────────────────────────────────────────────────────────────────

class ConversationOut(BaseModel):
    id: str
    title: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class MessageOut(BaseModel):
    id: str
    role: str
    content: str
    model_used: Optional[str]
    tokens_used: int
    created_at: datetime

    class Config:
        from_attributes = True


class ConversationDetailOut(BaseModel):
    id: str
    title: Optional[str]
    created_at: datetime
    messages: List[MessageOut]

    class Config:
        from_attributes = True


_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}


def _xlsx_to_text(data: bytes) -> str:
    from io import BytesIO
    import openpyxl
    wb = openpyxl.load_workbook(BytesIO(data), read_only=True, data_only=True)
    parts = []
    for sheet in wb.worksheets:
        rows = list(sheet.iter_rows(values_only=True))
        if not rows:
            continue
        parts.append(f"Sheet: {sheet.title}")
        for row in rows:
            parts.append("\t".join("" if v is None else str(v) for v in row))
    return "\n".join(parts)


def _xls_to_text(data: bytes) -> str:
    import xlrd
    wb = xlrd.open_workbook(file_contents=data)
    parts = []
    for sheet in wb.sheets():
        parts.append(f"Sheet: {sheet.name}")
        for r in range(sheet.nrows):
            parts.append("\t".join(str(sheet.cell_value(r, c)) for c in range(sheet.ncols)))
    return "\n".join(parts)


def _pptx_to_text(data: bytes) -> str:
    from io import BytesIO
    from pptx import Presentation
    prs = Presentation(BytesIO(data))
    parts = []
    for i, slide in enumerate(prs.slides, 1):
        texts = [s.text for s in slide.shapes if s.has_text_frame and s.text.strip()]
        if texts:
            parts.append(f"Slide {i}: " + " | ".join(texts))
    return "\n".join(parts)


async def _process_attachment(upload: UploadFile) -> dict:
    data = await upload.read()
    ct = (upload.content_type or "").lower()
    fname = upload.filename or "file"

    if ct.startswith("image/"):
        media_type = ct if ct in _IMAGE_TYPES else "image/jpeg"
        return {
            "kind": "image",
            "block": {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": base64.standard_b64encode(data).decode(),
                },
            },
        }

    text = ""
    try:
        if ct == "application/pdf" or fname.endswith(".pdf"):
            import fitz
            doc = fitz.open(stream=data, filetype="pdf")
            text = "\n".join(page.get_text() for page in doc)

        elif "wordprocessingml" in ct or fname.endswith(".docx"):
            from io import BytesIO
            import docx as _docx
            document = _docx.Document(BytesIO(data))
            text = "\n".join(p.text for p in document.paragraphs if p.text.strip())

        elif "spreadsheetml" in ct or fname.endswith(".xlsx"):
            text = _xlsx_to_text(data)

        elif ct == "application/vnd.ms-excel" or fname.endswith(".xls"):
            text = _xls_to_text(data)

        elif "presentationml" in ct or fname.endswith(".pptx"):
            text = _pptx_to_text(data)

        elif ct in ("text/csv", "application/csv") or fname.endswith(".csv"):
            text = data.decode("utf-8", errors="replace")

        elif ct.startswith("text/") or fname.endswith((".txt", ".md", ".json", ".yaml", ".yml", ".xml")):
            text = data.decode("utf-8", errors="replace")

        else:
            decoded = data.decode("utf-8", errors="replace")
            replacement_ratio = decoded.count("�") / max(len(decoded), 1)
            if replacement_ratio > 0.1:
                return {"kind": "unsupported", "filename": fname, "mime": ct}
            text = decoded

    except Exception as exc:
        log.warning("Attachment extraction failed (%s): %s", fname, exc)
        text = f"[Extraction failed: {exc}]"

    return {"kind": "text", "filename": fname, "text": text}


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_or_create_user(user_id: str, db: AsyncSession) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        user = User(id=user_id, name="Mike Villar")
        db.add(user)
        await db.flush()
    return user


async def _extract_and_save_facts(
    db,
    user_id: str,
    user_content: str,
    assistant_content: str,
    client: ModelClient,
) -> None:
    """Extract personal/professional facts from the exchange and save as memories."""
    if len(user_content) < 20 and len(assistant_content) < 80:
        return

    exchange = f"User: {user_content[:400]}\nAssistant: {assistant_content[:600]}"
    try:
        resp = await client.anthropic.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            system=(
                "Extract any personal facts, preferences, decisions, professional information, "
                "or life details about the user (Mike) from this exchange. "
                "Output a concise list of facts, one per line. "
                "If this is small talk, a test, or contains no personal information, output: SKIP"
            ),
            messages=[{"role": "user", "content": exchange}],
        )
        facts = resp.content[0].text.strip()
        if not facts or facts.upper().startswith("SKIP"):
            return
        from memory import mnemon as _mnemon
        await _mnemon.write(
            db, user_id, facts,
            domain="work", source="conversation", importance=4,
        )
    except Exception as exc:
        log.warning("Memory fact extraction failed: %s", exc)


async def _generate_title(messages: list, client: ModelClient) -> Optional[str]:
    """Generate a 3-5 word conversation title from recent exchanges."""
    recent = messages[-8:]
    context = "\n".join(
        f"{m['role'].upper()}: {m['content'][:300]}" for m in recent
    )
    try:
        resp = await client.anthropic.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=15,
            system="Write a 3-5 word title for this conversation. No quotes, no punctuation, no explanation. Just the title.",
            messages=[{"role": "user", "content": context}],
        )
        return resp.content[0].text.strip()[:80]
    except Exception as exc:
        log.warning("Title generation failed: %s", exc)
        return None


async def _get_conversation(conv_id: str, user_id: str, db: AsyncSession) -> Conversation:
    result = await db.execute(
        select(Conversation).where(
            Conversation.id == conv_id,
            Conversation.user_id == user_id,
        )
    )
    conv = result.scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/conversations", response_model=List[ConversationOut])
async def list_conversations(
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Conversation)
        .where(Conversation.user_id == user_id)
        .order_by(desc(Conversation.created_at))
        .limit(50)
    )
    return result.scalars().all()


@router.post("/conversations", response_model=ConversationOut, status_code=201)
async def create_conversation(
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_create_user(user_id, db)
    conv = Conversation(user_id=user_id)
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    return conv


@router.get("/conversations/{conversation_id}", response_model=ConversationDetailOut)
async def get_conversation(
    conversation_id: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    conv = await _get_conversation(conversation_id, user_id, db)
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at)
    )
    messages = result.scalars().all()

    title = conv.title
    if not title and messages:
        msg_dicts = [{"role": m.role, "content": m.content} for m in messages]
        client = get_model_client()
        title = await _generate_title(msg_dicts, client)
        if title:
            await db.execute(
                sa_update(Conversation)
                .where(Conversation.id == conversation_id)
                .values(title=title)
            )
            await db.commit()

    return ConversationDetailOut(
        id=conv.id,
        title=title,
        created_at=conv.created_at,
        messages=messages,
    )


@router.delete("/conversations/{conversation_id}", status_code=204)
async def delete_conversation(
    conversation_id: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    conv = await _get_conversation(conversation_id, user_id, db)
    await db.delete(conv)
    await db.commit()


@router.post("/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: str,
    content: str = Form(default=""),
    files: List[UploadFile] = File(default=[]),
    tier_override: Optional[str] = Form(default=None),
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Stream an assistant reply via SSE. Saves both messages to DB after completion."""
    conv = await _get_conversation(conversation_id, user_id, db)

    # Process attachments
    image_blocks: List[Any] = []
    doc_snippets: List[str] = []
    for upload in files:
        result = await _process_attachment(upload)
        if result["kind"] == "image":
            image_blocks.append(result["block"])
        elif result["kind"] == "unsupported":
            doc_snippets.append(
                f"[Attached: {result['filename']} — file type '{result['mime']}' could not be extracted as text. "
                f"Let the user know what types are supported (PDF, DOCX, XLSX, XLS, PPTX, CSV, TXT, images).]"
            )
        else:
            doc_snippets.append(f"[Attached: {result['filename']}]\n{result['text']}")

    # Classify the request to pick the right model tier.
    # Images always need vision (Claude). Override wins if provided.
    if image_blocks:
        tier = ModelTier.TIER3
    elif tier_override:
        tier = ModelTier(tier_override)
    elif content:
        tier = await classify(content)
    elif doc_snippets:
        tier = ModelTier.TIER2
    else:
        tier = ModelTier.TIER2

    # Build the text that goes to the model (doc text prepended)
    full_text = ("\n\n".join(doc_snippets) + "\n\n" + content).strip() if doc_snippets else content

    # Store plain text in DB (don't persist image bytes)
    db_content = content or " · ".join(
        (f"[image]" if b["type"] == "image" else "") for b in image_blocks
    ) or "[attachment]"
    user_msg = Message(
        conversation_id=conversation_id,
        role="user",
        content=db_content,
    )
    db.add(user_msg)
    await db.commit()

    db_result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at)
        .limit(40)
    )
    history = db_result.scalars().all()
    messages: List[Dict[str, Any]] = [
        {"role": m.role, "content": m.content} for m in history if m.role != "system"
    ]

    # Replace last user message with rich content if needed
    if messages and messages[-1]["role"] == "user":
        if image_blocks:
            parts: List[Any] = []
            if full_text:
                parts.append({"type": "text", "text": full_text})
            parts.extend(image_blocks)
            messages[-1]["content"] = parts
        elif full_text != content:
            messages[-1]["content"] = full_text

    system_prompt = await assemble(user_id, content or "attachment", db=db, tier=tier)

    client = get_model_client()
    # Tools only for TIER3 (Claude) — Ollama and RunPod don't support Anthropic tool_use.
    # The classifier is responsible for routing action requests to TIER3.
    tools = [CREATE_TASK_TOOL, CREATE_CALENDAR_EVENT_TOOL, PROPOSE_CALENDAR_EVENT_TOOL, PROPOSE_TASK_TOOL] if tier == ModelTier.TIER3 else None
    queue: asyncio.Queue = asyncio.Queue()

    async def background_generate() -> None:
        full_response: list[str] = []
        model_used: str = ""
        tokens_used: int = 0

        try:
            # ── Phase 1: stream the model response ──────────────────────────
            async with AsyncSessionLocal() as bg_db:

                async def _tool_executor(name: str, tool_input: dict) -> str:
                    if name == "create_task":
                        task = Task(
                            user_id=user_id,
                            title=tool_input["title"],
                            description=tool_input.get("description"),
                            priority=tool_input.get("priority", "normal"),
                            status="inbox",
                            source="chat",
                        )
                        bg_db.add(task)
                        await bg_db.commit()
                        priority = tool_input.get("priority", "normal")
                        return f"Task created: '{tool_input['title']}' added to inbox (priority: {priority})."

                    if name == "create_calendar_event":
                        try:
                            from sqlalchemy import select as _select
                            from db.models import Connector
                            conn_result = await bg_db.execute(
                                _select(Connector).where(
                                    Connector.user_id == user_id,
                                    Connector.name == "Google Calendar",
                                )
                            )
                            conn = conn_result.scalar_one_or_none()
                            if not conn or not conn.auth.get("refresh_token"):
                                return "Google Calendar not connected. Event not created."

                            from connectors.google_calendar import GoogleCalendarClient
                            from datetime import datetime, timedelta
                            import asyncio as _asyncio

                            gcal = GoogleCalendarClient(conn.auth)
                            start_dt = datetime.fromisoformat(tool_input["datetime_iso"])
                            duration = tool_input.get("duration_min", 60)
                            end_dt = start_dt + timedelta(minutes=duration)

                            event_body = {
                                "summary": tool_input["title"],
                                "start": {"dateTime": start_dt.isoformat(), "timeZone": str(start_dt.tzinfo or "UTC")},
                                "end": {"dateTime": end_dt.isoformat(), "timeZone": str(start_dt.tzinfo or "UTC")},
                            }
                            if tool_input.get("description"):
                                event_body["description"] = tool_input["description"]
                            if tool_input.get("location"):
                                event_body["location"] = tool_input["location"]
                            if tool_input.get("attendees"):
                                event_body["attendees"] = [{"email": e} for e in tool_input["attendees"]]

                            loop = _asyncio.get_event_loop()
                            result = await loop.run_in_executor(
                                None, lambda: gcal.create_event(**event_body)
                            )
                            link = result.get("htmlLink", "")
                            return f"Calendar event created: '{tool_input['title']}' on {start_dt.strftime('%b %-d at %-I:%M %p')}." + (f" View: {link}" if link else "")
                        except Exception as exc:
                            log.warning("create_calendar_event failed: %s", exc)
                            return f"Failed to create calendar event: {exc}"

                    return "Action completed."

                async for event in client.stream(messages, tier, system=system_prompt, tools=tools, tool_executor=_tool_executor):
                    if event["type"] == "chunk":
                        full_response.append(event.get("text", ""))
                        await queue.put(sse_event(event))
                    elif event["type"] in ("calendar_suggest", "task_suggest"):
                        await queue.put(sse_event(event))
                    elif event["type"] == "done":
                        model_used = event.get("model", "")
                        tokens_used = event.get("tokens", 0)
                    elif event["type"] == "error":
                        await queue.put(sse_event(event))

            assistant_content = "".join(full_response)

            # ── Phase 2: signal completion to client immediately ─────────────
            # Do NOT wait for DB saves / title gen / memory — client gets the
            # response right away, then we persist in the background.
            await queue.put(sse_event({"type": "done", "model": model_used, "tokens": tokens_used}))
            await queue.put(sse_done())

            # ── Phase 3: persist (client already showing the response) ───────
            async with AsyncSessionLocal() as bg_db:
                assistant_msg = Message(
                    conversation_id=conversation_id,
                    role="assistant",
                    content=assistant_content,
                    model_used=model_used or tier.value,
                    tokens_used=tokens_used,
                )
                bg_db.add(assistant_msg)
                await bg_db.commit()

                title_msgs = messages + [{"role": "assistant", "content": assistant_content}]
                new_title = await _generate_title(title_msgs, client)
                if new_title:
                    await bg_db.execute(
                        sa_update(Conversation)
                        .where(Conversation.id == conversation_id)
                        .values(title=new_title)
                    )
                    await bg_db.commit()

                user_input = content or "[attachment]"
                if len(user_input) >= 15 or len(assistant_content) >= 80:
                    try:
                        from memory import mnemon as _mnemon
                        summary = f"User: {user_input[:200]}\nTARS: {assistant_content[:300]}"
                        await _mnemon.write(
                            bg_db, user_id, summary,
                            domain="work", source="conversation", importance=2,
                        )
                    except Exception:
                        pass

                await _extract_and_save_facts(bg_db, user_id, user_input, assistant_content, client)

        except Exception as exc:
            log.error("background_generate failed: %s", exc)
            await queue.put(sse_event({"type": "error", "error": str(exc)}))
        finally:
            await queue.put(None)

    task = asyncio.create_task(background_generate())
    _active_bg_tasks.add(task)
    task.add_done_callback(_active_bg_tasks.discard)

    async def generate():
        while True:
            item = await queue.get()
            if item is None:
                break
            yield item

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
