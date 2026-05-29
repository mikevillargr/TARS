import asyncio
import base64
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import json as _json
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, desc, update as sa_update, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

from core.auth import require_auth
from core.router import classify
from core.model_client import (
    get_model_client, ModelClient, ModelTier,
    PROPOSE_CALENDAR_EVENT_TOOL, PROPOSE_TASK_TOOL,
    CREATE_TASK_TOOL, CREATE_CALENDAR_EVENT_TOOL,
    SAVE_MEMORY_TOOL, SAVE_TO_SECOND_BRAIN_TOOL,
    READ_EMAIL_TOOL, READ_MEETING_TOOL, SYNC_MEETINGS_TOOL, WEB_SEARCH_TOOL,
)
from core.context_assembler import assemble
from core.streaming import sse_event, sse_done
from db.session import get_db, AsyncSessionLocal
from db.models import Conversation, Message, User, Task, Artifact

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
    """
    Extract personal facts from what the USER said and save as memories.
    Only uses user_content as the fact source — assistant responses are NOT facts about Mike.
    Each fact is domain-tagged and saved individually for clean retrieval.
    """
    if len(user_content) < 20:
        return

    try:
        resp = await client.anthropic.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            system=(
                "Extract personal facts about Mike from his message. Only use what HE said — "
                "ignore the assistant context completely.\n"
                "Output each fact on its own line in this exact format:\n"
                "  DOMAIN|fact in third person\n"
                "Valid domains: work, personal, health, cycling, client\n"
                "Examples:\n"
                "  cycling|Mike's BMC Roadmachine has Ultegra Di2 and weighs 7.2 kg\n"
                "  health|Mike has Maxicare insurance, premium due June 1\n"
                "  work|Mike decided to delay the OpenRice campaign until Q3\n"
                "  client|Mike's NCH Inc. contact is Jaime Santos\n"
                "Output SKIP if no personal facts about Mike are present."
            ),
            messages=[{"role": "user", "content": f"Mike's message: {user_content[:500]}"}],
        )
        raw = resp.content[0].text.strip()
        if not raw or raw.upper() == "SKIP":
            return

        from memory import mnemon as _mnemon
        valid_domains = {"work", "personal", "health", "cycling", "client"}

        for line in raw.splitlines():
            line = line.strip().lstrip("•-* ")
            if not line or line.upper() == "SKIP":
                continue
            if "|" in line:
                domain, _, fact = line.partition("|")
                domain = domain.strip().lower()
                fact = fact.strip()
                if domain not in valid_domains:
                    domain = "work"
            else:
                fact = line
                domain = "work"

            if fact and len(fact) > 10:
                await _mnemon.write(
                    db, user_id, fact,
                    domain=domain, source="conversation", importance=4,
                )
    except Exception as exc:
        log.warning("Memory fact extraction failed: %s", exc)


_EXT_MAP = {
    "python": ".py", "typescript": ".ts", "tsx": ".tsx", "javascript": ".js",
    "jsx": ".jsx", "go": ".go", "rust": ".rs", "java": ".java", "ruby": ".rb",
    "bash": ".sh", "sh": ".sh", "diff": ".diff", "patch": ".patch",
    "sql": ".sql", "yaml": ".yaml", "yml": ".yml", "json": ".json",
    "css": ".css", "html": ".html", "markdown": ".md", "md": ".md",
    "csv": ".csv", "text": ".txt",
}

def _detect_artifacts(text: str) -> list[dict]:
    """
    Scan assistant response for artifact-worthy content.
    Returns a list of dicts: {filename, type, content}.

    Rules:
    - Code block with language tag AND ≥ 200 chars → Code artifact
    - Response ≥ 600 chars that starts with or contains a # heading → Document artifact
    """
    import re
    results = []

    # ── Code blocks with language hints ──────────────────────────────────────
    code_pattern = re.compile(r"```(\w+)\n(.*?)```", re.DOTALL)
    for m in code_pattern.finditer(text):
        lang = m.group(1).lower()
        body = m.group(2).strip()
        if len(body) < 200:
            continue
        ext = _EXT_MAP.get(lang, ".txt")
        artifact_type = "spreadsheet" if ext == ".csv" else "code"
        # Try to infer a filename from a comment on the first line
        first_line = body.splitlines()[0] if body else ""
        name_match = re.search(r"(?:#|//|--)\s*([\w.\-/]+\.\w+)", first_line)
        filename = name_match.group(1) if name_match else f"output{ext}"
        results.append({"filename": filename, "type": artifact_type, "content": body})

    # ── Document: long markdown response with a heading ───────────────────────
    if not results and len(text) >= 600:
        heading_match = re.search(r"^#{1,3} (.+)$", text, re.MULTILINE)
        if heading_match:
            title = heading_match.group(1).strip()
            # Sanitise title → filename
            safe = re.sub(r"[^\w\s\-]", "", title).strip().replace(" ", "_")[:50]
            results.append({"filename": f"{safe}.md", "type": "document", "content": text})

    return results


async def _auto_save_artifacts(
    db,
    user_id: str,
    conversation_id: str,
    message_id: str,
    assistant_content: str,
) -> None:
    """Detect and save any artifact-worthy content from an assistant response."""
    detected = _detect_artifacts(assistant_content)
    for art in detected:
        artifact = Artifact(
            user_id=user_id,
            filename=art["filename"],
            type=art["type"],
            source="chat",
            source_id=message_id,
            content=art["content"],
            version=1,
            size_bytes=len(art["content"].encode("utf-8")),
            tags=[],
        )
        db.add(artifact)
    if detected:
        await db.commit()


def _strip_tool_artifacts(text: str) -> str:
    """Remove raw tool-call tags and internal tool syntax from message text."""
    import re
    # Strip XML-style tool call blocks: <tool_name>...</tool_name> or <save_memory>...</save_memory>
    text = re.sub(r"<[a-z_]+>.*?</[a-z_]+>", "", text, flags=re.DOTALL)
    # Strip standalone opening/closing tags: <save_memory>, </save_memory>
    text = re.sub(r"</?[a-z_]+>", "", text)
    # Strip function-call style: save_memory(content='...') or tool_name(...)
    text = re.sub(r"\b[a-z_]+\([^)]{0,200}\)", "", text)
    return text.strip()


async def _generate_title(messages: list, client: ModelClient) -> Optional[str]:
    """Generate a 3-5 word conversation title from recent exchanges."""
    recent = messages[-8:]
    context = "\n".join(
        f"{m['role'].upper()}: {_strip_tool_artifacts(str(m.get('content', '')))[:300]}"
        for m in recent
        if m.get("content") and not str(m.get("content", "")).startswith("<tool")
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
    # Delete messages first — no DB-level cascade on this FK
    await db.execute(sa_delete(Message).where(Message.conversation_id == conversation_id))
    await db.delete(conv)
    await db.commit()


@router.post("/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: str,
    content: str = Form(default=""),
    files: List[UploadFile] = File(default=[]),
    artifact_id: Optional[str] = Form(default=None),
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

    # If artifact_id provided, inject artifact content as invisible model context
    if artifact_id:
        art_result = await db.execute(
            select(Artifact).where(Artifact.id == artifact_id, Artifact.user_id == user_id)
        )
        art_obj = art_result.scalar_one_or_none()
        if art_obj and art_obj.content:
            MAX_ART = 12000
            art_text = art_obj.content
            if len(art_text) > MAX_ART:
                art_text = art_text[:MAX_ART] + f"\n\n[… truncated, {len(art_obj.content):,} total chars]"
            doc_snippets.append(
                f"[UPLOADED FILE: {art_obj.filename}]\n{art_text}\n\n"
                f"Analyze this file and provide a clear summary of the key insights."
            )

    # Classify the request to pick the right model tier.
    # Images always need vision (Claude). Override wins if provided.
    if image_blocks:
        tier = ModelTier.TIER3
    elif artifact_id:
        tier = ModelTier.TIER3  # artifact analysis always uses the frontier model
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
    tools = [
        CREATE_TASK_TOOL,
        CREATE_CALENDAR_EVENT_TOOL,
        PROPOSE_CALENDAR_EVENT_TOOL,
        PROPOSE_TASK_TOOL,
        SAVE_MEMORY_TOOL,
        SAVE_TO_SECOND_BRAIN_TOOL,
        READ_EMAIL_TOOL,
        READ_MEETING_TOOL,
        SYNC_MEETINGS_TOOL,
        WEB_SEARCH_TOOL,
    ] if tier == ModelTier.TIER3 else None
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

                    if name == "save_memory":
                        try:
                            from memory import mnemon as _mnemon
                            await _mnemon.write(
                                bg_db,
                                user_id,
                                tool_input["content"],
                                domain=tool_input.get("domain", "work"),
                                source="chat",
                                importance=tool_input.get("importance", 3),
                            )
                            return f"Saved to memory: '{tool_input['content'][:80]}...'" if len(tool_input["content"]) > 80 else f"Saved to memory: '{tool_input['content']}'"
                        except Exception as exc:
                            log.warning("save_memory tool failed: %s", exc)
                            return f"Failed to save memory: {exc}"

                    if name == "save_to_second_brain":
                        try:
                            from memory import second_brain as _sb
                            await _sb.ingest_document(
                                bg_db,
                                user_id,
                                content=tool_input["content"],
                                title=tool_input["title"],
                                tags=tool_input.get("tags", []),
                                domain=tool_input.get("domain", "work"),
                            )
                            return f"Saved to Second Brain: '{tool_input['title']}'"
                        except Exception as exc:
                            log.warning("save_to_second_brain tool failed: %s", exc)
                            return f"Failed to save to Second Brain: {exc}"

                    if name == "read_email":
                        try:
                            from sqlalchemy import select as _select
                            from db.models import Connector
                            conn_result = await bg_db.execute(
                                _select(Connector).where(
                                    Connector.user_id == user_id,
                                    Connector.name == "Gmail",
                                )
                            )
                            conn = conn_result.scalar_one_or_none()
                            if not conn or not conn.auth.get("refresh_token"):
                                return "Gmail not connected."

                            from connectors.gmail import GmailClient, extract_thread_text
                            import asyncio as _asyncio

                            gclient = GmailClient(conn.auth)
                            loop = _asyncio.get_event_loop()

                            thread_id = tool_input.get("thread_id", "").strip()
                            if not thread_id and tool_input.get("search_query"):
                                threads = await loop.run_in_executor(
                                    None,
                                    lambda: gclient.list_threads(
                                        query=tool_input["search_query"], max_results=1
                                    ),
                                )
                                if not threads:
                                    return "No email found matching that search."
                                thread_id = threads[0]["id"]

                            if not thread_id:
                                return "Provide a thread_id or search_query."

                            # thread_id from context is first 8 chars — find full id
                            if len(thread_id) == 8:
                                candidates = await loop.run_in_executor(
                                    None,
                                    lambda: gclient.list_threads(query="in:inbox", max_results=20),
                                )
                                match = next((t["id"] for t in candidates if t["id"].startswith(thread_id)), None)
                                if match:
                                    thread_id = match

                            thread = await loop.run_in_executor(None, lambda: gclient.get_thread(thread_id))
                            body = extract_thread_text(thread)
                            if not body:
                                return "Email body is empty or could not be extracted."
                            # Cap at 4000 chars to stay within token budget
                            if len(body) > 4000:
                                body = body[:4000] + "\n\n[... email truncated ...]"
                            return body
                        except Exception as exc:
                            log.warning("read_email tool failed: %s", exc)
                            return f"Failed to read email: {exc}"

                    if name == "sync_meetings":
                        try:
                            from core.config import settings as _settings
                            if not _settings.fireflies_api_key:
                                return "Fireflies API key not configured."
                            from connectors.fireflies import FirefliesClient
                            from jobs.meeting_processor import ingest_from_webhook, process_meeting as _proc_meeting
                            ff_client = FirefliesClient(_settings.fireflies_api_key)
                            transcripts = await ff_client.list_recent(limit=20)
                            synced = 0
                            skipped = 0
                            for t in transcripts:
                                tid = t.get("id")
                                if not tid:
                                    continue
                                new_id = await ingest_from_webhook(bg_db, user_id, tid)
                                if new_id:
                                    await _proc_meeting(bg_db, new_id, user_id)
                                    synced += 1
                                else:
                                    skipped += 1
                            if synced:
                                return f"Synced {synced} new meeting{'s' if synced != 1 else ''} from Fireflies ({skipped} already up to date)."
                            else:
                                return f"All {skipped} recent Fireflies meetings are already up to date."
                        except Exception as exc:
                            log.warning("sync_meetings tool failed: %s", exc)
                            return f"Failed to sync meetings: {exc}"

                    if name == "read_meeting":
                        try:
                            from sqlalchemy import select as _select
                            from db.models import Meeting, MeetingActionItem

                            meeting_id = tool_input.get("meeting_id", "").strip()
                            include_transcript = tool_input.get("include_transcript", False)

                            m_result = await bg_db.execute(
                                _select(Meeting).where(
                                    Meeting.id == meeting_id,
                                    Meeting.user_id == user_id,
                                )
                            )
                            meeting = m_result.scalar_one_or_none()
                            if not meeting:
                                return f"Meeting '{meeting_id}' not found."

                            ai_result = await bg_db.execute(
                                _select(MeetingActionItem).where(
                                    MeetingActionItem.meeting_id == meeting_id
                                )
                            )
                            action_items = ai_result.scalars().all()

                            parts = [f"# {meeting.title}"]
                            if meeting.started_at:
                                parts.append(f"Date: {meeting.started_at.strftime('%B %-d, %Y')}")
                            if meeting.attendees:
                                parts.append(f"Attendees: {', '.join(meeting.attendees)}")
                            parts.append(f"Status: {meeting.status}")

                            if meeting.summary:
                                parts.append(f"\n## Summary\n{meeting.summary}")

                            if action_items:
                                parts.append(f"\n## Action Items ({len(action_items)})")
                                for ai in action_items:
                                    owner = f" [{ai.owner}]" if ai.owner else ""
                                    done = " ✓" if ai.task_id else ""
                                    parts.append(f"  • {ai.raw_text}{owner}{done}")

                            if include_transcript and meeting.transcript:
                                # Cap transcript to avoid token explosion
                                transcript = meeting.transcript
                                if len(transcript) > 6000:
                                    transcript = transcript[:6000] + "\n\n[... transcript truncated ...]"
                                parts.append(f"\n## Transcript\n{transcript}")
                            elif not include_transcript and meeting.transcript:
                                parts.append(f"\n(Transcript available — call read_meeting again with include_transcript=true to see it.)")

                            return "\n".join(parts)
                        except Exception as exc:
                            log.warning("read_meeting tool failed: %s", exc)
                            return f"Failed to read meeting: {exc}"

                    if name == "web_search":
                        try:
                            from core.config import settings as _settings
                            if not _settings.tavily_api_key:
                                return "Web search is not configured (missing TAVILY_API_KEY)."
                            import httpx as _httpx
                            query = tool_input["query"]
                            depth = tool_input.get("search_depth", "basic")
                            async with _httpx.AsyncClient(timeout=15.0) as _hx:
                                resp = await _hx.post(
                                    "https://api.tavily.com/search",
                                    json={
                                        "api_key": _settings.tavily_api_key,
                                        "query": query,
                                        "search_depth": depth,
                                        "max_results": 6,
                                        "include_answer": True,
                                    },
                                )
                                resp.raise_for_status()
                                data = resp.json()

                            lines = [f"Search: {query}\n"]
                            if data.get("answer"):
                                lines.append(f"Summary: {data['answer']}\n")
                            for r in data.get("results", []):
                                lines.append(f"• {r['title']}")
                                lines.append(f"  {r['url']}")
                                if r.get("content"):
                                    lines.append(f"  {r['content'][:300]}")
                                lines.append("")
                            return "\n".join(lines)
                        except Exception as exc:
                            log.warning("web_search tool failed: %s", exc)
                            return f"Web search failed: {exc}"

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
                await _extract_and_save_facts(bg_db, user_id, user_input, assistant_content, client)
                await _auto_save_artifacts(bg_db, user_id, conversation_id, assistant_msg.id, assistant_content)

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
