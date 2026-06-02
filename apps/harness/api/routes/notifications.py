"""
WebSocket endpoint for real-time user-level notifications.

GET /api/notifications/stream?token=<jwt>

Events pushed to the client:
  {type: "new_message",  conversation_id, message_id, preview, created_at}
  {type: "ping"}                          ← keepalive every 25 s

Phase 2: extend publish() calls with calendar, task, meeting events.
"""
import asyncio
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from agents import notifications as _notif
from core.auth import verify_ws_token

log = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/stream")
async def notification_stream(
    websocket: WebSocket,
    token: str = Query(...),
):
    user_id = verify_ws_token(token)
    if not user_id:
        await websocket.close(code=4401)
        return

    await websocket.accept()

    async def send_fn(event: dict) -> None:
        if websocket.client_state == WebSocketState.CONNECTED:
            await websocket.send_json(event)

    _notif.subscribe(user_id, send_fn)

    try:
        while websocket.client_state == WebSocketState.CONNECTED:
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=25)
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.debug("Notification WS closed: %s", exc)
    finally:
        _notif.unsubscribe(user_id, send_fn)
