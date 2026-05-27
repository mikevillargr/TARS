"""SSE (Server-Sent Events) helpers for FastAPI StreamingResponse."""

import json
from typing import AsyncGenerator, Any


def sse_event(data: Any) -> str:
    """Format a dict as an SSE data line."""
    return f"data: {json.dumps(data)}\n\n"


def sse_done() -> str:
    return "data: [DONE]\n\n"


async def stream_to_sse(
    source: AsyncGenerator[dict, None],
) -> AsyncGenerator[str, None]:
    """Wrap a model stream generator into SSE-formatted strings."""
    async for event in source:
        yield sse_event(event)
    yield sse_done()
