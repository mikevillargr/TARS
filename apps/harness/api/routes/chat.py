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
from core.model_client import get_model_client, ModelClient, ModelTier
from core.context_assembler import assemble
from core.streaming import sse_event, sse_done
from db.session import get_db
from db.models import Conversation, Message, User

router = APIRouter()


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

    # Any file attachment → force Tier 3 (Claude handles documents best)
    if files:
        tier = ModelTier.TIER3
    elif tier_override:
        tier = ModelTier(tier_override)
    else:
        tier = await classify(content)

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

    system_prompt = await assemble(user_id, content or "attachment", db=db)

    client = get_model_client()
    full_response: list[str] = []
    model_used: str = ""
    tokens_used: int = 0

    async def generate():
        nonlocal model_used, tokens_used

        # Stream chunks to client immediately; intercept done to post-process
        async for event in client.stream(messages, tier, system=system_prompt):
            if event["type"] == "chunk":
                full_response.append(event.get("text", ""))
                yield sse_event(event)
            elif event["type"] == "done":
                model_used = event.get("model", "")
                tokens_used = event.get("tokens", 0)
            elif event["type"] == "error":
                yield sse_event(event)

        assistant_content = "".join(full_response)
        assistant_msg = Message(
            conversation_id=conversation_id,
            role="assistant",
            content=assistant_content,
            model_used=model_used or tier.value,
            tokens_used=tokens_used,
        )
        db.add(assistant_msg)
        await db.commit()

        # Generate a fresh title from the full exchange (including this response)
        title_messages = messages + [{"role": "assistant", "content": assistant_content}]
        new_title = await _generate_title(title_messages, client)
        if new_title:
            await db.execute(
                sa_update(Conversation)
                .where(Conversation.id == conversation_id)
                .values(title=new_title)
            )
            await db.commit()

        yield sse_event({"type": "done", "model": model_used, "tokens": tokens_used, "title": new_title})
        yield sse_done()

        # Auto-save exchange to Mnemon (low importance, conversational source)
        try:
            from memory import mnemon as _mnemon
            summary = f"User: {(content or '[attachment]')[:200]}\nTARS: {assistant_content[:300]}"
            await _mnemon.write(
                db, user_id, summary,
                domain="work", source="conversation", importance=2,
            )
        except Exception:
            pass

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
