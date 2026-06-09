"""
Email routes — explicit send confirmation gate.
The model never sends email directly; it emits a draft card, and the user
approves here via POST /api/email/confirm-send.
"""
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import require_auth
from db.session import get_db
from db.models import Connector

log = logging.getLogger(__name__)
router = APIRouter()


class ConfirmSendRequest(BaseModel):
    to: str
    subject: str
    body: str
    cc: Optional[str] = None
    thread_id: Optional[str] = None


@router.post("/confirm-send")
async def confirm_send(
    req: ConfirmSendRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    conn_result = await db.execute(
        select(Connector).where(
            Connector.user_id == user_id,
            Connector.name == "Gmail",
        )
    )
    conn = conn_result.scalar_one_or_none()
    if not conn or not conn.auth.get("refresh_token"):
        raise HTTPException(status_code=400, detail="Gmail not connected.")

    try:
        import asyncio
        from connectors.gmail import GmailClient
        gclient = GmailClient(conn.auth)
        loop = asyncio.get_event_loop()

        thread_id = req.thread_id
        # Model context uses 8-char prefix IDs — expand to full Gmail thread ID
        if thread_id and len(thread_id) == 8:
            candidates = await loop.run_in_executor(
                None,
                lambda: gclient.list_threads(query="in:inbox", max_results=20),
            )
            match = next((t["id"] for t in candidates if t["id"].startswith(thread_id)), None)
            if match:
                thread_id = match
            else:
                log.warning("confirm_send: could not expand 8-char thread_id %s; sending without thread", thread_id)
                thread_id = None

        result = await loop.run_in_executor(
            None,
            lambda: gclient.send_email(
                to=req.to,
                subject=req.subject,
                body=req.body,
                cc=req.cc,
                thread_id=thread_id,
            ),
        )
        return {"ok": True, "message": result}
    except Exception as exc:
        log.warning("confirm_send failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
