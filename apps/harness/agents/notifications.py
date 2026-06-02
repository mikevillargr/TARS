"""
User-level notification broadcaster.

_notify_chat() publishes here after inserting a DB message.
The /api/notifications/stream WebSocket endpoint subscribes here.

This is the foundation for Phase 2 push notifications — the broadcaster
is keyed by user_id so it can later drive web-push, mobile, etc.
"""
import asyncio
import logging
from collections import deque
from typing import Callable

log = logging.getLogger(__name__)

# user_id -> set of send_fn callables
_subs: dict[str, set[Callable]] = {}

# user_id -> recent event ring buffer (for reconnect replay)
_buffers: dict[str, deque] = {}


def subscribe(user_id: str, send_fn: Callable) -> None:
    _subs.setdefault(user_id, set()).add(send_fn)
    # Replay last 20 events so reconnect catches up
    asyncio.create_task(_replay(user_id, send_fn))


def unsubscribe(user_id: str, send_fn: Callable) -> None:
    _subs.get(user_id, set()).discard(send_fn)


async def _replay(user_id: str, send_fn: Callable) -> None:
    for event in list(_buffers.get(user_id, [])):
        try:
            await send_fn(event)
        except Exception:
            return


async def publish(user_id: str, event: dict) -> None:
    buf = _buffers.setdefault(user_id, deque(maxlen=20))
    buf.append(event)
    dead: set = set()
    for send_fn in list(_subs.get(user_id, set())):
        try:
            await send_fn(event)
        except Exception:
            dead.add(send_fn)
    if dead:
        _subs.get(user_id, set()).difference_update(dead)
