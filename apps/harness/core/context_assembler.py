"""
Context assembler — builds the system prompt for each conversation turn.
Stubs for memory/second brain injection until Session 3.
"""

from datetime import datetime, timezone

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
    # These will be populated in Session 3 via actual DB lookups
    mnemon_context: str = "No memories retrieved yet.",
    second_brain_context: str = "No knowledge retrieved yet.",
    active_tasks_count: int = 0,
    todays_meetings: str = "No meetings",
    last_seen: str = "First interaction",
) -> str:
    """Return the fully assembled system prompt for this turn."""
    return SYSTEM_TEMPLATE.format(
        mnemon_context=mnemon_context,
        second_brain_context=second_brain_context,
        active_tasks_count=active_tasks_count,
        todays_meetings=todays_meetings,
        last_seen=last_seen,
    )
