"""
Fireflies.ai connector — GraphQL API + webhook receiver.
API docs: https://docs.fireflies.ai/graphql-api/transcript
"""

import logging
from typing import Optional

import httpx

log = logging.getLogger(__name__)

FIREFLIES_API = "https://api.fireflies.ai/graphql"

_TRANSCRIPT_QUERY = """
query GetTranscript($id: String!) {
  transcript(id: $id) {
    id
    title
    date
    duration
    participants
    summary {
      overview
      action_items
      keywords
      shorthand_bullet
    }
    sentences {
      index
      speaker_name
      text
      start_time
      end_time
    }
  }
}
"""

_LIST_QUERY = """
query ListTranscripts($limit: Int) {
  transcripts(limit: $limit) {
    id
    title
    date
    duration
    participants
  }
}
"""


class FirefliesClient:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    async def fetch_transcript(self, transcript_id: str) -> Optional[dict]:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                FIREFLIES_API,
                headers=self._headers,
                json={"query": _TRANSCRIPT_QUERY, "variables": {"id": transcript_id}},
            )
            resp.raise_for_status()
            data = resp.json()

        if "errors" in data:
            log.error("Fireflies GraphQL errors: %s", data["errors"])
            return None

        return data.get("data", {}).get("transcript")

    async def list_recent(self, limit: int = 20) -> list:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                FIREFLIES_API,
                headers=self._headers,
                json={"query": _LIST_QUERY, "variables": {"limit": limit}},
            )
            resp.raise_for_status()
            data = resp.json()

        if "errors" in data:
            log.error("Fireflies GraphQL errors: %s", data["errors"])
            return []

        return data.get("data", {}).get("transcripts") or []


def build_plain_transcript(sentences: list) -> str:
    """Convert Fireflies sentence objects into readable transcript text."""
    if not sentences:
        return ""
    lines = []
    current_speaker = None
    for s in sentences:
        speaker = s.get("speaker_name") or "Unknown"
        text = s.get("text", "").strip()
        if not text:
            continue
        if speaker != current_speaker:
            lines.append(f"\n{speaker}:")
            current_speaker = speaker
        lines.append(f"  {text}")
    return "\n".join(lines).strip()
