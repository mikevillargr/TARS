from datetime import datetime, timezone
from typing import List, Optional
import json as _json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

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


class SendMessageRequest(BaseModel):
    content: str
    tier_override: Optional[str] = None  # "tier1"|"tier2"|"tier3"


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
    """Ask Haiku for a 3-5 word conversation title based on recent exchanges."""
    recent = messages[-8:]
    context = "\n".join(
        f"{m['role'].upper()}: {m['content'][:300]}" for m in recent
    )
    try:
        resp = await client.anthropic.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=15,
            system="Write a 3-5 word title for this conversation. No quotes, no punctuation, no explanation. Just the title.",
            messages=[{"role": "user", "content": context}],
        )
        return resp.content[0].text.strip()[:80]
    except Exception:
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
    return ConversationDetailOut(
        id=conv.id,
        title=conv.title,
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
    body: SendMessageRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Stream an assistant reply via SSE. Saves both messages to DB after completion."""
    conv = await _get_conversation(conversation_id, user_id, db)

    tier = ModelTier(body.tier_override) if body.tier_override else await classify(body.content)

    user_msg = Message(
        conversation_id=conversation_id,
        role="user",
        content=body.content,
    )
    db.add(user_msg)
    await db.commit()

    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at)
        .limit(40)
    )
    history = result.scalars().all()
    messages = [{"role": m.role, "content": m.content} for m in history if m.role != "system"]

    system_prompt = await assemble(user_id, body.content, db=db)

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
            conv.title = new_title
            await db.commit()

        yield sse_event({"type": "done", "model": model_used, "tokens": tokens_used, "title": new_title})
        yield sse_done()

        # Auto-save exchange to Mnemon (low importance, conversational source)
        try:
            from memory import mnemon as _mnemon
            summary = f"User: {body.content[:200]}\nTARS: {assistant_content[:300]}"
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
