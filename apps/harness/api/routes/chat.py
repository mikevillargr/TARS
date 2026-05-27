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
from core.model_client import get_model_client, ModelTier
from core.context_assembler import assemble
from core.streaming import stream_to_sse
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

    tier = ModelTier(body.tier_override) if body.tier_override else classify(body.content)

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

    if not conv.title:
        conv.title = body.content[:60]
        await db.commit()

    client = get_model_client()
    full_response: list[str] = []
    model_used: str = ""
    tokens_used: int = 0

    async def generate():
        nonlocal model_used, tokens_used
        async for chunk in stream_to_sse(
            client.stream(messages, tier, system=system_prompt)
        ):
            if chunk.startswith("data: {"):
                try:
                    payload = _json.loads(chunk[6:])
                    if payload.get("type") == "chunk":
                        full_response.append(payload.get("text", ""))
                    elif payload.get("type") == "done":
                        model_used = payload.get("model", "")
                        tokens_used = payload.get("tokens", 0)
                except Exception:
                    pass
            yield chunk

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
