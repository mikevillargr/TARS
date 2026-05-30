"""
Unified model client.

Tier 1: Claude Haiku  — always available, ~200-500ms, cheap (~$0.001/req)
Tier 2: RunPod        — GPU inference via RunPod Serverless; model set by WORKHORSE_MODEL env var
         cold fallback: Haiku  if message ≤ 500 chars (standard tasks)
                        Sonnet if message > 500 chars or contains complexity signals
Tier 3: Claude Sonnet — frontier, tools, streaming, always Claude

NOTE: Ollama is fully retired. The classifier is a Haiku API call (router.py).
"""

import asyncio
import json
import logging
import re
import time
from enum import Enum
from typing import AsyncGenerator, List, Dict, Any, Optional

import httpx
import anthropic

# ── XML tool-call strip ────────────────────────────────────────────────────────
# Non-Claude models (RunPod Tier 2) sometimes emit XML tool-call markup
# (e.g. <function_calls>…</function_calls>) in response text.
# Capabilities are gated to Tier 3 only, but this filter is a safety net.
_TOOL_XML_RE = re.compile(
    r"<function_calls>.*?</function_calls>|"
    r"<invoke\b[^>]*>.*?</invoke>|"
    r"<parameter\b[^>]*>.*?</parameter>",
    re.DOTALL | re.IGNORECASE,
)

def _strip_tool_xml(text: str) -> str:
    """Remove any stray XML tool-call markup from model output."""
    cleaned = _TOOL_XML_RE.sub("", text)
    # Collapse runs of blank lines left behind
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()

from core.config import settings

logger = logging.getLogger(__name__)


class ModelTier(str, Enum):
    TIER1 = "tier1"
    TIER2 = "tier2"
    TIER3 = "tier3"


# ─── Tool definitions ────────────────────────────────────────────────────────

PROPOSE_CALENDAR_EVENT_TOOL = {
    "name": "propose_calendar_event",
    "description": (
        "Suggest adding an event to the user's Google Calendar. Use this when the "
        "conversation establishes a specific date, time, and activity — e.g. a meeting "
        "invitation in an email, a deadline to block time for, or a call just scheduled. "
        "Do NOT use for vague future plans or hypotheticals."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Short event title (5 words max)"},
            "datetime_iso": {"type": "string", "description": "ISO 8601 with timezone offset (e.g. 2026-05-30T14:00:00+08:00)"},
            "duration_min": {"type": "integer", "description": "Duration in minutes. Default 60."},
            "description": {"type": "string", "description": "Optional brief context notes"},
            "location": {"type": "string", "description": "Optional location"},
        },
        "required": ["title", "datetime_iso"],
    },
}

CREATE_CALENDAR_EVENT_TOOL = {
    "name": "create_calendar_event",
    "description": (
        "Create a Google Calendar event immediately. Use when the user explicitly asks "
        "you to book, schedule, or add a meeting, call, or appointment. "
        "Execute without asking for confirmation."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Short event title"},
            "datetime_iso": {"type": "string", "description": "ISO 8601 with timezone offset"},
            "duration_min": {"type": "integer", "description": "Duration in minutes. Default 60."},
            "description": {"type": "string", "description": "Optional notes or agenda"},
            "location": {"type": "string", "description": "Optional location or video link"},
            "attendees": {"type": "array", "items": {"type": "string"}, "description": "Attendee email addresses"},
        },
        "required": ["title", "datetime_iso"],
    },
}

CREATE_TASK_TOOL = {
    "name": "create_task",
    "description": (
        "Create a task in the user's task inbox. Use this when the user explicitly asks "
        "you to add, create, track, or remember a task, to-do, action item, follow-up, "
        "or reminder. Execute immediately — do not ask for confirmation."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Short task title (10 words max)"},
            "description": {"type": "string", "description": "Optional context or details"},
            "priority": {"type": "string", "enum": ["urgent", "high", "normal", "low"], "description": "Task priority. Default normal."},
            "due_at": {"type": "string", "description": "Optional due date in ISO 8601 format"},
        },
        "required": ["title"],
    },
}

PROPOSE_TASK_TOOL = {
    "name": "propose_task",
    "description": (
        "Suggest a task when you proactively detect an implied action item from context "
        "that the user has NOT explicitly asked you to track. Shows a confirmation chip. "
        "Do NOT use when the user explicitly asks you to add a task — use create_task instead."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Short task title (10 words max)"},
            "description": {"type": "string", "description": "Optional context or details"},
            "priority": {"type": "string", "enum": ["urgent", "high", "normal", "low"], "description": "Task priority. Default normal."},
            "due_at": {"type": "string", "description": "Optional due date in ISO 8601 format"},
        },
        "required": ["title"],
    },
}

SAVE_MEMORY_TOOL = {
    "name": "save_memory",
    "description": (
        "Save a fact, note, or piece of information to Mike's episodic memory. "
        "Use immediately whenever Mike says 'remember this', 'note that', 'keep in mind', "
        "or shares a personal fact, preference, or decision worth preserving. "
        "Also use proactively when you detect important context (e.g. a new client, "
        "a key preference, a health update). Memories are semantically searched and "
        "injected into every future conversation."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "content": {
                "type": "string",
                "description": "The fact or note to remember. Write in third person, be specific: 'Mike prefers...' / 'Mike decided...'",
            },
            "domain": {
                "type": "string",
                "enum": ["work", "personal", "health", "cycling", "client"],
                "description": "Domain/category. Default: work.",
            },
            "importance": {
                "type": "integer",
                "description": "1-5. Default 3. Use 5 for critical facts (e.g. client preferences, health conditions).",
            },
        },
        "required": ["content"],
    },
}

READ_EMAIL_TOOL = {
    "name": "read_email",
    "description": (
        "Read the full body of an email thread. Use this when the user asks to "
        "read, open, or see the full content of a specific email. "
        "Pass the 8-char thread_id shown in brackets in the Gmail context (e.g. [a1b2c3d4]), "
        "or provide a search_query to find the email by subject/sender."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "thread_id": {
                "type": "string",
                "description": "Thread ID from Gmail context (the value in brackets, e.g. 'a1b2c3d4').",
            },
            "search_query": {
                "type": "string",
                "description": "Gmail search query if thread_id is unknown (e.g. 'from:john@example.com subject:invoice').",
            },
        },
    },
}

SEND_EMAIL_TOOL = {
    "name": "send_email",
    "description": (
        "Send an email via Mike's Gmail account. Use when he explicitly asks you to send, "
        "reply to, forward, or draft-and-send an email. "
        "Always include the key details (to, subject, body preview) in your chat message "
        "so Mike sees what you're about to send before or immediately after it goes out. "
        "For replies to an existing thread, supply the thread_id shown as [thread_id] in "
        "the Gmail context."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "to": {
                "type": "string",
                "description": "Recipient email address(es), comma-separated if multiple.",
            },
            "subject": {
                "type": "string",
                "description": "Email subject line.",
            },
            "body": {
                "type": "string",
                "description": "Plain-text email body. Write clearly and concisely.",
            },
            "cc": {
                "type": "string",
                "description": "CC address(es), comma-separated. Omit if not needed.",
            },
            "thread_id": {
                "type": "string",
                "description": (
                    "Thread ID from Gmail context to send as a reply. "
                    "Include when replying to an existing email thread."
                ),
            },
        },
        "required": ["to", "subject", "body"],
    },
}

READ_MEETING_TOOL = {
    "name": "read_meeting",
    "description": (
        "Read the full details of a specific meeting — summary, action items, and optionally the "
        "transcript. Use whenever Mike asks what was discussed in a meeting, what action items came "
        "out of it, who attended, or any details about a past meeting. "
        "The meeting ID is shown in the [RECENT MEETINGS] section of context as [id:...]."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "meeting_id": {
                "type": "string",
                "description": "The full meeting ID from the [RECENT MEETINGS] context (the value after 'id:').",
            },
            "include_transcript": {
                "type": "boolean",
                "description": (
                    "Set true to include the full transcript text. Default false — "
                    "summary and action items are usually sufficient."
                ),
            },
        },
        "required": ["meeting_id"],
    },
}

SYNC_MEETINGS_TOOL = {
    "name": "sync_meetings",
    "description": (
        "Pull the latest meeting transcripts from Fireflies and process them into TARS. "
        "Use when Mike asks to sync meetings, check recent meetings, or wants to see what "
        "meetings have been recorded. This fetches the last 20 Fireflies transcripts, "
        "ingests any new ones, runs AI processing (summary + action items), and saves "
        "everything to memory. Returns the count of meetings synced."
    ),
    "input_schema": {
        "type": "object",
        "properties": {},
    },
}

WEB_SEARCH_TOOL = {
    "name": "web_search",
    "description": (
        "Search the web for current information. Use when Mike asks about recent events, "
        "news, prices, live data, or anything that requires up-to-date information beyond "
        "your training cutoff. Also use for research tasks where you need to find specific "
        "facts, articles, or external references. "
        "Returns titles, URLs, and content snippets from the top results."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query. Be specific and concise for best results.",
            },
            "search_depth": {
                "type": "string",
                "enum": ["basic", "advanced"],
                "description": "basic = fast, top results. advanced = deeper research. Default: basic.",
            },
        },
        "required": ["query"],
    },
}

SAVE_TO_SECOND_BRAIN_TOOL = {
    "name": "save_to_second_brain",
    "description": (
        "Save a note, research finding, or piece of reusable knowledge to Mike's "
        "Second Brain knowledge base. Use when Mike says 'save this', 'add this to my "
        "second brain', 'note this for later', or when you produce analysis/research "
        "worth preserving for future retrieval. "
        "Second Brain = reusable reference knowledge. Memory = personal facts and events."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "content": {
                "type": "string",
                "description": "The note or knowledge to save. Markdown OK.",
            },
            "title": {
                "type": "string",
                "description": "Short descriptive title (used for search).",
            },
            "tags": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Tags for organization, e.g. ['client', 'growth-rocket', 'seo']",
            },
            "domain": {
                "type": "string",
                "description": "Domain category (work, personal, health, cycling, client). Default: work.",
            },
        },
        "required": ["content", "title"],
    },
}

GENERATE_DOCUMENT_TOOL = {
    "name": "generate_document",
    "description": (
        "Generate a Word document (DOCX) from structured content and save it to Artifacts. "
        "Use when Mike asks to create, write, draft, or generate a document, report, proposal, "
        "brief, memo, or any formal written piece. Supports headings, bullets, and numbered lists "
        "via markdown syntax. Returns the artifact ID and filename so Mike can download it."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Document title — used as the main heading and filename.",
            },
            "content": {
                "type": "string",
                "description": (
                    "Full document body. Use # H1, ## H2, ### H3 for headings; "
                    "- or * for bullet points; 1. 2. for numbered lists; plain text for paragraphs. "
                    "Write the complete, detailed content — don't abbreviate."
                ),
            },
            "filename": {
                "type": "string",
                "description": "Optional base filename (no extension). Defaults to slugified title.",
            },
        },
        "required": ["title", "content"],
    },
}

GENERATE_PRESENTATION_TOOL = {
    "name": "generate_presentation",
    "description": (
        "Generate a PowerPoint presentation (PPTX) from a slide structure and save it to Artifacts. "
        "Use when Mike asks to create, build, or generate a presentation, slide deck, pitch deck, "
        "or slides. Produces a PPTX file with a title slide plus content slides."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Presentation title — shown on the title slide.",
            },
            "subtitle": {
                "type": "string",
                "description": "Optional subtitle shown on the title slide.",
            },
            "slides": {
                "type": "array",
                "description": "Array of content slides after the title slide.",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "Slide heading."},
                        "bullets": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Bullet points for this slide. Write complete sentences.",
                        },
                    },
                    "required": ["title", "bullets"],
                },
            },
            "filename": {
                "type": "string",
                "description": "Optional base filename (no extension).",
            },
        },
        "required": ["title", "slides"],
    },
}

GENERATE_PDF_TOOL = {
    "name": "generate_pdf",
    "description": (
        "Generate a PDF document from structured content and save it to Artifacts. "
        "Use when Mike explicitly asks for a PDF, or when generating a report/document that "
        "should be in PDF format. Supports headings (# ## ###), bullet lists (- *), and paragraphs."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Document title.",
            },
            "content": {
                "type": "string",
                "description": "Content in markdown-like format. # H1, ## H2, ### H3, - bullets, plain paragraphs.",
            },
            "filename": {
                "type": "string",
                "description": "Optional base filename (no extension).",
            },
        },
        "required": ["title", "content"],
    },
}


LOOKUP_CONTACT_TOOL = {
    "name": "lookup_contact",
    "description": (
        "Look up a single person Mike knows. Use whenever Mike refers to a person by name "
        "or asks who someone is (e.g. 'who is Sarah?', 'what's Tim's company?'). "
        "Searches Mike's Google Contacts mirror first; falls back to live Google search if "
        "no local match. Returns the contact's org, role, primary email/phone, and any "
        "TARS-derived context about them."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Name, partial name, or email of the person to look up.",
            },
        },
        "required": ["query"],
    },
}


SEARCH_CONTACTS_TOOL = {
    "name": "search_contacts",
    "description": (
        "Search Mike's contacts and return multiple matches (up to 10). Use when Mike asks "
        "broader questions like 'who works at Acme?', 'list my contacts from NCH', or "
        "'who do I know in product?'. For single-person lookups use lookup_contact instead."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query — matches against name, email, and organization.",
            },
            "limit": {
                "type": "integer",
                "description": "Max results to return. Default 10.",
            },
        },
        "required": ["query"],
    },
}


# ─── Tier routing tables ─────────────────────────────────────────────────────

# Tier 2 display label derived from the model name (strip org prefix for brevity)
_tier2_label = settings.workhorse_model.split("/")[-1].lower() if settings.workhorse_model else "runpod"

TIER_MODELS = {
    ModelTier.TIER1: "haiku",
    ModelTier.TIER2: _tier2_label,
    ModelTier.TIER3: "claude-sonnet-4-6",
}

# Only Tier 2 uses RunPod; Tier 1 = Haiku, Tier 3 = Sonnet (both Anthropic API)
TIER_ENDPOINTS = {
    ModelTier.TIER2: settings.runpod_endpoint_32b,
}

TIER_MODEL_NAMES = {
    ModelTier.TIER2: settings.workhorse_model,
}

_TIER_COOLDOWN = {
    ModelTier.TIER2: 120.0,
}

# RunPod Tier 2 timeout: 32B warm = 2-10s; 40s covers heavy generation
_RUNPOD_TIMEOUT = {
    ModelTier.TIER2: 40.0,
}

# Tier 2 cold fallback: complexity signals → Sonnet; otherwise → Haiku
_COMPLEX_T2_RE = re.compile(
    r"\b(comprehensive|in.?depth|detailed analysis|full analysis|thorough|"
    r"strategy|proposal|formal report|deep dive)\b",
    re.IGNORECASE,
)


def _tier2_cold_model(messages: list) -> Optional[str]:
    """
    Decide which model to use when RunPod 32B is cold.
    Returns settings.tier1_model (Haiku) for short/standard requests,
    None (→ Sonnet default) for long/complex ones.
    """
    last = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")
    if not isinstance(last, str):
        return None  # image/rich content → Sonnet
    if len(last) > 500 or _COMPLEX_T2_RE.search(last):
        return None  # complex → Sonnet
    return settings.tier1_model  # standard → Haiku


class ModelClient:
    def __init__(self):
        self._anthropic: Optional[anthropic.AsyncAnthropic] = None
        self._failed_at: dict[ModelTier, Optional[float]] = {
            ModelTier.TIER2: None,
        }

    @property
    def anthropic(self) -> anthropic.AsyncAnthropic:
        if not self._anthropic:
            self._anthropic = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        return self._anthropic

    def _is_warm(self, tier: ModelTier) -> bool:
        failed_at = self._failed_at.get(tier)
        if failed_at is None:
            return True
        return (time.monotonic() - failed_at) >= _TIER_COOLDOWN.get(tier, 120.0)

    def _mark_failed(self, tier: ModelTier) -> None:
        self._failed_at[tier] = time.monotonic()
        logger.warning("RunPod %s marked cold — falling back for %.0fs", tier, _TIER_COOLDOWN.get(tier, 120.0))

    def _mark_warm(self, tier: ModelTier) -> None:
        if self._failed_at.get(tier) is not None:
            logger.info("RunPod %s recovered — resuming tier routing", tier)
        self._failed_at[tier] = None

    async def stream(
        self,
        messages: List[Dict[str, str]],
        tier: ModelTier,
        system: str = "",
        max_tokens: int = 4096,
        tools: Optional[List[Dict]] = None,
        tool_executor=None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        # ── Tier 3: Claude Sonnet — frontier, tools, streaming ───────────────
        if tier == ModelTier.TIER3:
            async for event in self._stream_anthropic(
                messages, system, max_tokens, tools=tools, tool_executor=tool_executor
            ):
                yield event
            return

        # ── Tier 1: Claude Haiku — always available, no cold start ───────────
        if tier == ModelTier.TIER1:
            async for event in self._stream_anthropic(
                messages, system, min(max_tokens, 1024), model=settings.tier1_model
            ):
                yield event
            return

        # ── Tier 2: RunPod 32B → Haiku or Sonnet when cold ───────────────────
        endpoint_2 = TIER_ENDPOINTS.get(ModelTier.TIER2)
        if endpoint_2 and self._is_warm(ModelTier.TIER2):
            # Pass tools so RunPod-level fallback can hand them to Sonnet if RunPod fails
            async for event in self._stream_runpod(messages, system, max_tokens, tier=ModelTier.TIER2, tools=tools, tool_executor=tool_executor):
                yield event
        else:
            # If tools were requested, always use Sonnet so they remain available
            cold_model = None if tools else _tier2_cold_model(messages)
            logger.info(
                "Tier2 RunPod cold — falling back to %s",
                "sonnet (tools)" if tools else ("haiku" if cold_model else "sonnet"),
            )
            async for event in self._stream_anthropic(messages, system, max_tokens, model=cold_model, tools=tools, tool_executor=tool_executor):
                yield event

    async def _stream_anthropic(
        self,
        messages: List[Dict[str, str]],
        system: str,
        max_tokens: int,
        *,
        model: Optional[str] = None,
        tools: Optional[List[Dict]] = None,
        tool_executor=None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        # Tools that emit a suggestion chip — user confirms before action
        _SUGGESTION_TOOLS = {"propose_calendar_event", "propose_task"}

        model = model or "claude-sonnet-4-6"
        current_messages = list(messages)
        total_input = 0
        total_output = 0

        try:
            for _round in range(8):  # max 8 tool-call rounds before giving up
                kwargs: Dict[str, Any] = dict(
                    model=model,
                    max_tokens=max_tokens,
                    system=system,
                    messages=current_messages,
                )
                if tools:
                    kwargs["tools"] = tools

                async with self.anthropic.messages.stream(**kwargs) as stream:
                    async for text in stream.text_stream:
                        yield {"type": "chunk", "text": text}

                    final = await stream.get_final_message()
                    total_input += final.usage.input_tokens
                    total_output += final.usage.output_tokens

                    tool_uses = [b for b in final.content if b.type == "tool_use"]

                    # Emit suggestion events for proposal tools (shown as chips in UI)
                    for b in tool_uses:
                        if b.name == "propose_calendar_event":
                            yield {"type": "calendar_suggest", "tool_use_id": b.id, **b.input}
                        elif b.name == "propose_task":
                            yield {"type": "task_suggest", "tool_use_id": b.id, **b.input}

                    if final.stop_reason != "tool_use" or not tool_uses:
                        # Natural completion — no more tool calls needed
                        yield {"type": "done", "model": model, "tokens": total_input + total_output}
                        return

                    # Build assistant turn + execute tools → continue loop
                    asst_content = []
                    for b in final.content:
                        if b.type == "text":
                            asst_content.append({"type": "text", "text": b.text})
                        elif b.type == "tool_use":
                            asst_content.append({
                                "type": "tool_use", "id": b.id,
                                "name": b.name, "input": b.input,
                            })

                    tool_results = []
                    for b in tool_uses:
                        if b.name in _SUGGESTION_TOOLS:
                            result = "Suggestion shown to user."
                        elif tool_executor is not None:
                            try:
                                result = await tool_executor(b.name, b.input)
                            except Exception as exc:
                                result = f"Tool error ({b.name}): {exc}"
                        else:
                            result = "Action completed."
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": b.id,
                            "content": result,
                        })

                    current_messages = current_messages + [
                        {"role": "assistant", "content": asst_content},
                        {"role": "user", "content": tool_results},
                    ]

            # Exceeded max rounds — emit done with accumulated token count
            yield {"type": "done", "model": model, "tokens": total_input + total_output}

        except Exception as e:
            yield {"type": "error", "error": str(e)}

    async def _stream_runpod(
        self,
        messages: List[Dict[str, str]],
        system: str,
        max_tokens: int,
        *,
        tier: ModelTier,
        tools: Optional[List[Dict]] = None,
        tool_executor=None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Call a RunPod serverless Ollama endpoint (Tier 2 only)."""
        endpoint = TIER_ENDPOINTS[tier]
        model_name = TIER_MODEL_NAMES[tier]
        model_label = TIER_MODELS[tier]

        all_messages = []
        if system:
            all_messages.append({"role": "system", "content": system})
        all_messages.extend(messages)

        payload = {
            "input": {
                "openai_route": "/v1/chat/completions",
                "openai_input": {
                    "model": model_name,
                    "messages": all_messages,
                    "max_tokens": max_tokens,
                    "stream": False,
                },
            }
        }

        timeout = _RUNPOD_TIMEOUT.get(tier, 40.0)
        logger.info("RunPod %s request: model=%s timeout=%.0fs", tier, model_name, timeout)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(
                    endpoint,
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {settings.runpod_api_key}",
                        "Content-Type": "application/json",
                    },
                )
            resp.raise_for_status()
            data = resp.json()

            output = data.get("output", {})
            if isinstance(output, list) and output:
                output = output[0]
            choices = output.get("choices", []) if isinstance(output, dict) else []

            if not choices:
                self._mark_failed(tier)
                logger.warning("RunPod %s returned empty choices — falling back to Claude", tier)
                # If tools were requested, always use Sonnet so they remain available
                cold_model = None if tools else _tier2_cold_model(messages)
                async for event in self._stream_anthropic(messages, system, max_tokens, model=cold_model, tools=tools, tool_executor=tool_executor):
                    yield event
                return

            self._mark_warm(tier)
            full_text: str = choices[0].get("message", {}).get("content", "")
            full_text = _strip_tool_xml(full_text)   # remove any stray XML tool-call markup
            usage = output.get("usage", {})
            total_tokens = usage.get("total_tokens", 0)

            chunk_size = 40
            for i in range(0, len(full_text), chunk_size):
                yield {"type": "chunk", "text": full_text[i: i + chunk_size]}
                await asyncio.sleep(0.02)

            yield {"type": "done", "model": model_label, "tokens": total_tokens}

        except Exception as e:
            logger.warning("RunPod %s failed (%s: %s) — falling back", tier, type(e).__name__, e)
            self._mark_failed(tier)
            # If tools were requested, always use Sonnet so they remain available
            cold_model = None if tools else _tier2_cold_model(messages)
            async for event in self._stream_anthropic(messages, system, max_tokens, model=cold_model, tools=tools, tool_executor=tool_executor):
                yield event


# App-level singleton
_client: Optional[ModelClient] = None


def get_model_client() -> ModelClient:
    global _client
    if not _client:
        _client = ModelClient()
    return _client
