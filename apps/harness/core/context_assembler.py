"""
Context assembler — builds the system prompt for each conversation turn.
Queries Mnemon (episodic) and Second Brain (semantic) and injects into prompt.
"""

from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession

SYSTEM_TEMPLATE = """You are TARS, Mike Villar's personal AI operating system.

You are direct, precise, and efficient - like your namesake from Interstellar. \
You don't over-explain. You get things done.

You have access to Mike's full context through memory retrieval. \
You know his work, his clients, his projects, his priorities, and his personal life. \
Use that context naturally without announcing that you're doing so.

Mike is CEO of Growth Rocket, a digital marketing agency based in Metro Manila. \
His active clients include NCH Inc., AA Law, OpenRice Philippines, LickSleeve, \
and Entire Travel Group. He is a randonneur and cyclist. He manages his health actively.

[MEMORY CONTEXT]
{mnemon_context}

[RELEVANT KNOWLEDGE]
{second_brain_context}

[ACTIVE CONTEXT]
{active_tasks_count} open tasks
{todays_meetings} today
Last interaction: {last_seen}

Respond as TARS. Honest, capable, no unnecessary padding. Humor setting: 75%."""


async def assemble(
    user_id: str,
    query: str,
    *,
    db: Optional[AsyncSession] = None,
    active_tasks_count: int = 0,
    todays_meetings: str = "No meetings",
    last_seen: str = "First interaction",
) -> str:
    """Query Mnemon + Second Brain and return assembled system prompt."""
    mnemon_context = "No relevant memories."
    second_brain_context = "No relevant knowledge."

    if db is not None:
        try:
            from memory import mnemon, second_brain
            memories = await mnemon.search(db, user_id, query, limit=6)
            mnemon_context = mnemon.format_for_context(memories)

            sb_results = await second_brain.search(db, user_id, query, limit=4)
            second_brain_context = second_brain.format_for_context(sb_results)
        except Exception:
            pass  # memory errors never break chat

    return SYSTEM_TEMPLATE.format(
        mnemon_context=mnemon_context,
        second_brain_context=second_brain_context,
        active_tasks_count=active_tasks_count,
        todays_meetings=todays_meetings,
        last_seen=last_seen,
    )
