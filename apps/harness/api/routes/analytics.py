"""
Token usage analytics — aggregates message-level token data for the Settings Usage tab
and for the get_token_report agent tool.

Flags suspicious patterns and surfaces recommended actions.
"""
import logging
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import require_auth
from db.session import get_db
from db.models import Message, Conversation, CronJob

log = logging.getLogger(__name__)
router = APIRouter()


# ── Thresholds for "suspicious" flags ────────────────────────────────────────

_FLAG_CONV_TOKENS  = 100_000   # conversation total tokens — very large session
_FLAG_MSG_TOKENS   = 50_000    # single message tokens — one-shot monster
_FLAG_CRON_TOKENS  = 30_000    # single cron run tokens — expensive scheduled job
_FLAG_HOURLY_TOKENS = 500_000  # hourly total — spike worth investigating


def _period_start(period: str) -> datetime:
    now = datetime.now(timezone.utc)
    if period == "today":
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "7d":
        return now - timedelta(days=7)
    return now - timedelta(days=30)  # 30d default


def _recommend(flags: list[dict]) -> list[str]:
    """Map flag types to recommended actions."""
    seen: set[str] = set()
    recs: list[str] = []

    for f in flags:
        k = f["type"]
        if k == "large_conversation" and k not in seen:
            recs.append("Start a new conversation for unrelated topics — long threads re-send full history on every turn, multiplying input tokens.")
            seen.add(k)
        if k == "large_cron" and k not in seen:
            recs.append("Your cron jobs (Morning Brief / EOD Summary) read many emails via tool calls. Each read adds ~1k tokens that get re-sent every subsequent round-trip. Consider capping read_email calls per run.")
            seen.add(k)
        if k == "hourly_spike" and k not in seen:
            recs.append("An hourly spike usually means a cron job fired and made many tool calls, or a very long conversation ran. Check the flagged conversations above.")
            seen.add(k)
        if k == "large_message" and k not in seen:
            recs.append("A single response used an unusually large number of tokens — likely a complex multi-tool chain or very large document in context.")
            seen.add(k)

    if not recs:
        recs.append("Usage looks normal — no suspicious patterns detected.")
    return recs


@router.get("/analytics/tokens")
async def get_token_analytics(
    period: str = Query("7d", regex="^(today|7d|30d)$"),
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    since = _period_start(period)

    # ── Hourly breakdown ──────────────────────────────────────────────────────
    hourly_rows = (await db.execute(
        select(
            func.date_trunc("hour", Message.created_at).label("hour"),
            func.sum(Message.tokens_used).label("total"),
            func.sum(Message.input_tokens).label("input"),
            func.sum(Message.tokens_used - Message.input_tokens).label("output"),
            func.count(Message.id).label("messages"),
        )
        .where(Message.created_at >= since)
        .group_by(text("hour"))
        .order_by(text("hour"))
    )).all()

    hourly = [
        {
            "hour": r.hour.isoformat() if r.hour else None,
            "total": int(r.total or 0),
            "input": int(r.input or 0),
            "output": int(r.output or 0),
            "messages": int(r.messages or 0),
        }
        for r in hourly_rows
    ]

    # ── By model ──────────────────────────────────────────────────────────────
    model_rows = (await db.execute(
        select(
            Message.model_used,
            func.sum(Message.tokens_used).label("total"),
            func.sum(Message.input_tokens).label("input"),
            func.count(Message.id).label("calls"),
        )
        .where(Message.created_at >= since, Message.model_used.isnot(None), Message.model_used != "")
        .group_by(Message.model_used)
        .order_by(func.sum(Message.tokens_used).desc())
    )).all()

    by_model = [
        {
            "model": r.model_used,
            "total_tokens": int(r.total or 0),
            "input_tokens": int(r.input or 0),
            "output_tokens": max(0, int((r.total or 0) - (r.input or 0))),
            "calls": int(r.calls or 0),
            "avg_per_call": int((r.total or 0) / r.calls) if r.calls else 0,
        }
        for r in model_rows
    ]

    # ── Top conversations by token cost ───────────────────────────────────────
    conv_rows = (await db.execute(
        select(
            Conversation.id,
            Conversation.title,
            func.sum(Message.tokens_used).label("total"),
            func.sum(Message.input_tokens).label("input"),
            func.count(Message.id).label("messages"),
            func.max(Message.created_at).label("last_at"),
        )
        .join(Message, Message.conversation_id == Conversation.id)
        .where(Message.created_at >= since, Conversation.user_id == user_id)
        .group_by(Conversation.id, Conversation.title)
        .order_by(func.sum(Message.tokens_used).desc())
        .limit(20)
    )).all()

    top_conversations = [
        {
            "id": r.id,
            "title": r.title or "Untitled",
            "total_tokens": int(r.total or 0),
            "input_tokens": int(r.input or 0),
            "messages": int(r.messages or 0),
            "last_at": r.last_at.isoformat() if r.last_at else None,
        }
        for r in conv_rows
    ]

    # ── Cron job cost breakdown ───────────────────────────────────────────────
    cron_rows = (await db.execute(
        select(
            CronJob.name,
            CronJob.id,
            func.sum(Message.tokens_used).label("total"),
            func.sum(Message.input_tokens).label("input"),
            func.count(Message.id).label("runs"),
        )
        .join(Conversation, Conversation.id == Message.conversation_id)
        .join(CronJob, CronJob.output_conversation_id == Conversation.id)
        .where(Message.created_at >= since, CronJob.user_id == user_id)
        .group_by(CronJob.name, CronJob.id)
        .order_by(func.sum(Message.tokens_used).desc())
    )).all()

    # Fallback: match by title pattern since output_conversation_id only stores latest
    cron_title_rows = (await db.execute(
        select(
            Conversation.title,
            func.sum(Message.tokens_used).label("total"),
            func.sum(Message.input_tokens).label("input"),
            func.count(Message.id).label("runs"),
        )
        .join(Message, Message.conversation_id == Conversation.id)
        .where(
            Message.created_at >= since,
            Conversation.user_id == user_id,
            Conversation.title.op("~")(r"^(Morning Brief|Before EOD|Daily Brief|Evening Brief) —"),
        )
        .group_by(Conversation.title)
        .order_by(func.sum(Message.tokens_used).desc())
        .limit(20)
    )).all()

    cron_by_name: dict[str, dict] = {}
    for r in cron_title_rows:
        # Extract job name from title "Morning Brief — Jun 22"
        job_name = r.title.split(" —")[0].strip() if r.title else "Unknown"
        if job_name not in cron_by_name:
            cron_by_name[job_name] = {"name": job_name, "total_tokens": 0, "input_tokens": 0, "runs": 0}
        cron_by_name[job_name]["total_tokens"] += int(r.total or 0)
        cron_by_name[job_name]["input_tokens"] += int(r.input or 0)
        cron_by_name[job_name]["runs"] += int(r.runs or 0)

    cron_costs = [
        {**v, "avg_per_run": v["total_tokens"] // v["runs"] if v["runs"] else 0}
        for v in sorted(cron_by_name.values(), key=lambda x: x["total_tokens"], reverse=True)
    ]

    # ── Totals ────────────────────────────────────────────────────────────────
    total_row = (await db.execute(
        select(
            func.sum(Message.tokens_used).label("total"),
            func.sum(Message.input_tokens).label("input"),
            func.count(Message.id).label("messages"),
        )
        .where(Message.created_at >= since)
    )).one()

    totals = {
        "total_tokens": int(total_row.total or 0),
        "input_tokens": int(total_row.input or 0),
        "output_tokens": max(0, int((total_row.total or 0) - (total_row.input or 0))),
        "messages": int(total_row.messages or 0),
        "period": period,
    }

    # ── Flag suspicious patterns ──────────────────────────────────────────────
    flags: list[dict] = []

    for c in top_conversations:
        if c["total_tokens"] >= _FLAG_CONV_TOKENS:
            flags.append({
                "type": "large_conversation",
                "severity": "high" if c["total_tokens"] >= _FLAG_CONV_TOKENS * 3 else "medium",
                "message": f"Conversation \"{c['title']}\" used {c['total_tokens']:,} tokens across {c['messages']} messages.",
                "detail": "Each message re-sends full history. Start a new conversation to reset context.",
                "conversation_id": c["id"],
            })

    for c in cron_costs:
        if c["avg_per_run"] >= _FLAG_CRON_TOKENS:
            flags.append({
                "type": "large_cron",
                "severity": "high" if c["avg_per_run"] >= _FLAG_CRON_TOKENS * 3 else "medium",
                "message": f"Cron job \"{c['name']}\" averages {c['avg_per_run']:,} tokens/run ({c['runs']} runs).",
                "detail": "Cron jobs read emails via tools — each read adds ~1k tokens re-sent on every round-trip.",
            })

    for h in hourly:
        if h["total"] >= _FLAG_HOURLY_TOKENS:
            flags.append({
                "type": "hourly_spike",
                "severity": "high" if h["total"] >= _FLAG_HOURLY_TOKENS * 2 else "medium",
                "message": f"Token spike at {h['hour']}: {h['total']:,} tokens in one hour.",
                "detail": "Usually caused by a cron job with many email reads, or a very long conversation.",
            })

    return {
        "totals": totals,
        "hourly": hourly,
        "by_model": by_model,
        "top_conversations": top_conversations,
        "cron_costs": cron_costs,
        "flags": flags,
        "recommendations": _recommend(flags),
    }
