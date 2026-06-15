"""
Unified model client.

Tier 1: fast model    — always available, ~200-500ms, cheap; handles simple queries + single tool calls
Tier 2: workhorse     — standard tasks; writing, coding, analysis, multi-step tool chains
Tier 3: frontier      — complex reasoning, long context, client deliverables

Provider and model per tier are configurable via the Settings UI (Anthropic or Z.ai).
All tiers have full tool access. Any tier can emit escalation_requested to re-run at Tier 3.

NOTE: Ollama and RunPod are retired. The classifier uses the Tier 1 model API (router.py).
"""

from __future__ import annotations  # makes all annotations lazy — avoids 'anthropic' property shadowing the module

import asyncio
import json
import logging
import re
from enum import Enum
from typing import AsyncGenerator, List, Dict, Any, Optional

import anthropic

# ── XML tool-call strip ────────────────────────────────────────────────────────
# Safety net: some third-party models occasionally emit XML tool-call markup
# in response text instead of structured tool calls.
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

UPDATE_CALENDAR_EVENT_TOOL = {
    "name": "update_calendar_event",
    "description": (
        "Update an existing Google Calendar event. Use when the user asks to reschedule, "
        "rename, change the time, location, duration, attendees, or description of an event. "
        "Pass only the fields that should change — unspecified fields are left as-is. "
        "The event_id is shown in brackets in the calendar context, e.g. [abc12345]."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "event_id": {"type": "string", "description": "The event ID from the calendar context (the value in brackets)"},
            "title": {"type": "string", "description": "New event title"},
            "datetime_iso": {"type": "string", "description": "New start time in ISO 8601 with timezone offset"},
            "duration_min": {"type": "integer", "description": "New duration in minutes"},
            "description": {"type": "string", "description": "New description or agenda"},
            "location": {"type": "string", "description": "New location or video link"},
            "attendees": {"type": "array", "items": {"type": "string"}, "description": "Full attendee email list (replaces existing list)"},
        },
        "required": ["event_id"],
    },
}

DELETE_CALENDAR_EVENT_TOOL = {
    "name": "delete_calendar_event",
    "description": (
        "Delete a Google Calendar event. Use when the user asks to cancel, remove, or delete "
        "a specific event. The event_id is shown in brackets in the calendar context, e.g. [abc12345]. "
        "Execute immediately — do not ask for confirmation."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "event_id": {"type": "string", "description": "The event ID from the calendar context (the value in brackets)"},
            "title": {"type": "string", "description": "Event title — for confirmation message only, not used in the API call"},
        },
        "required": ["event_id"],
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
        "Prepare an email draft for Mike to review. Call this when he asks you to draft, "
        "write, reply to, forward, or send an email. This tool NEVER sends automatically — "
        "it surfaces a draft card in the chat so Mike can read it and approve before anything "
        "goes out. Do NOT describe what you're about to send in your text reply; just call "
        "this tool and let the draft card speak for itself. "
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
        "Also use when Mike asks to see images, photos, or visuals of anything — this tool "
        "returns inline images from search results which are rendered automatically in chat. "
        "Returns titles, URLs, content snippets, and images from the top results."
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
        "Look up a single person in Mike's Google Contacts. "
        "ALWAYS call this tool when Mike asks for ANY of the following about a person: "
        "phone number, mobile number, email address, company, job title, or any other contact detail. "
        "Trigger phrases: 'what's X's number', 'call X', 'X's phone', 'X's email', 'who is X', "
        "'what company is X at', 'what's X's title', 'how do I reach X', 'contact details for X'. "
        "Searches the local Google Contacts mirror (628+ contacts with phone numbers for most). "
        "Falls back to a live Google search if no local match. "
        "Returns: display name, organization, job title, primary email, primary phone number, "
        "all phone numbers on file, and any TARS-saved context notes."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": (
                    "Name, partial name, email address, or phone number of the person to look up. "
                    "Examples: 'Sarah', 'ken@growth-rocket.com', '+639171234567', 'Tim from NCH'."
                ),
            },
            "show_card": {
                "type": "boolean",
                "description": (
                    "Whether to surface a contact card in the UI. "
                    "Pass true only when Mike is explicitly asking about a person (who is X, contact details for X). "
                    "Pass false (default) when resolving contact details to complete another action (send email, schedule meeting, etc.)."
                ),
            },
        },
        "required": ["query"],
    },
}


SEARCH_CONTACTS_TOOL = {
    "name": "search_contacts",
    "description": (
        "Search Mike's Google Contacts and return multiple matches — including phone numbers, "
        "emails, organizations, and job titles for each result. "
        "Use for: 'who works at Acme?', 'list contacts from NCH', 'how many contacts do I have?', "
        "'everyone in marketing', 'who do I know at that company?', 'find all contacts with a phone number'. "
        "Always returns the total unique contact count in the response header. "
        "Leave query empty to browse all contacts. Use offset to paginate."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": (
                    "Search term matched against name, email, organization, and phone number. "
                    "Leave empty to list all contacts."
                ),
            },
            "limit": {
                "type": "integer",
                "description": "Max results to return. Default 25.",
            },
            "offset": {
                "type": "integer",
                "description": "Pagination offset for browsing large result sets. Default 0.",
            },
            "show_card": {
                "type": "boolean",
                "description": (
                    "Whether to surface contact cards in the UI. Default false. "
                    "Pass true ONLY when Mike is explicitly browsing contacts (e.g. 'show me contacts at NCH', 'who do I know at Acme'). "
                    "Never pass true when resolving a contact to complete another action (draft email, schedule meeting, create task, etc.)."
                ),
            },
        },
        "required": [],
    },
}


CREATE_CONTACT_TOOL = {
    "name": "create_contact",
    "description": (
        "Create a new contact in Mike's Google Contacts and sync it locally. "
        "Use when Mike says 'add X to my contacts', 'save X as a contact', "
        "'create a contact for X', or when approving a pending/discovered contact. "
        "After creation the contact is immediately searchable via lookup_contact."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Full name of the contact (required).",
            },
            "email": {
                "type": "string",
                "description": "Primary email address.",
            },
            "phone": {
                "type": "string",
                "description": "Primary phone number (include country code where known, e.g. +63917...).",
            },
            "organization": {
                "type": "string",
                "description": "Company or organization name.",
            },
            "job_title": {
                "type": "string",
                "description": "Job title or role.",
            },
            "notes": {
                "type": "string",
                "description": "Any notes about this person (saved to Google Contacts biography field).",
            },
        },
        "required": ["name"],
    },
}


UPDATE_CONTACT_TOOL = {
    "name": "update_contact",
    "description": (
        "Update an existing contact in Mike's Google Contacts. "
        "Use when Mike says 'update X's number', 'add a phone for X', 'change X's company', "
        "'update X's details', or 'add notes about X'. "
        "Identify the contact by name or email (query), then provide only the fields to change. "
        "Unchanged fields are left as-is. Changes sync to Google Contacts immediately."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Name or email to identify which contact to update.",
            },
            "name": {
                "type": "string",
                "description": "New display name (only if renaming).",
            },
            "email": {
                "type": "string",
                "description": "New primary email address.",
            },
            "phone": {
                "type": "string",
                "description": "New primary phone number.",
            },
            "organization": {
                "type": "string",
                "description": "New company or organization.",
            },
            "job_title": {
                "type": "string",
                "description": "New job title.",
            },
            "notes": {
                "type": "string",
                "description": "Notes to set (replaces existing biography/notes field).",
            },
        },
        "required": ["query"],
    },
}


SEARCH_PLACES_TOOL = {
    "name": "search_places",
    "description": (
        "Search for places, restaurants, hotels, landmarks, and businesses using OpenStreetMap. "
        "Use when Mike asks: 'find a restaurant near X', 'where is Y?', 'good cafes in BGC', "
        "'hotels near the airport', 'any malls nearby', 'restaurants near me', 'where am I?', "
        "or any place/location search. Returns a map card with navigation links (Google Maps, Waze). "
        "IMPORTANT: When Mike's GPS coordinates are available in context (MIKE'S CURRENT LOCATION), "
        "OMIT the 'near' parameter — the tool uses his GPS automatically and gives accurate nearby results. "
        "Only set 'near' when Mike explicitly names a DIFFERENT location from where he is."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": (
                    "Place name, type, or description. "
                    "For 'where am I?' use 'my location'. "
                    "For nearby searches use the category name, e.g. 'mall', 'cafe', 'restaurant'. "
                    "Examples: 'Japanese restaurant', 'Ayala Museum', 'McDonalds BGC', 'mall'."
                ),
            },
            "near": {
                "type": "string",
                "description": (
                    "Location bias — ONLY use when Mike names a specific DIFFERENT place, "
                    "e.g. 'restaurants in Makati' (when he is not in Makati). "
                    "OMIT entirely when Mike says 'near me', 'nearby', 'around here', or when "
                    "GPS coordinates are already in the system context."
                ),
            },
            "category": {
                "type": "string",
                "description": (
                    "Optional category filter for nearby POI search. "
                    "Valid values: restaurant, cafe, bar, hotel, grocery, pharmacy, hospital, "
                    "bank, atm, gas_station, parking, gym, park, museum, mall, cinema, spa, "
                    "salon, dentist, school, university, church."
                ),
            },
            "limit": {
                "type": "integer",
                "description": "Max results to return. Default 5.",
            },
        },
        "required": ["query"],
    },
}

SAVE_PLACE_TOOL = {
    "name": "save_place",
    "description": (
        "Save a place to Mike's personal places list for quick retrieval later. "
        "Use when Mike says 'save this place', 'bookmark this restaurant', 'remember this location', "
        "or 'add this to my places'. Can also add notes and tags. "
        "Saved places appear when Mike asks 'what places have I saved?' or 'my saved restaurants'."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Name of the place.",
            },
            "address": {
                "type": "string",
                "description": "Street address or location description.",
            },
            "lat": {
                "type": "number",
                "description": "Latitude coordinate.",
            },
            "lng": {
                "type": "number",
                "description": "Longitude coordinate.",
            },
            "category": {
                "type": "string",
                "description": "Category (restaurant, cafe, hotel, etc.).",
            },
            "tags": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Tags for organisation, e.g. ['favourite', 'client-lunch', 'bgc'].",
            },
            "notes": {
                "type": "string",
                "description": "Optional notes about the place (e.g. 'great for client lunches', 'valet parking available').",
            },
            "osm_id": {
                "type": "string",
                "description": "OpenStreetMap ID (from a previous search_places result).",
            },
            "osm_type": {
                "type": "string",
                "description": "OSM element type: node, way, or relation.",
            },
        },
        "required": ["name", "lat", "lng"],
    },
}

GET_SAVED_PLACES_TOOL = {
    "name": "get_saved_places",
    "description": (
        "Retrieve Mike's saved/bookmarked places. "
        "Use when Mike asks: 'what places have I saved?', 'show my saved restaurants', "
        "'my favourite cafes', 'places I bookmarked', or 'where do I usually eat?'. "
        "Returns a map card for each saved place with navigation links."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Optional search term to filter saved places by name, address, or notes.",
            },
            "category": {
                "type": "string",
                "description": "Optional category to filter by (restaurant, cafe, hotel, etc.).",
            },
            "limit": {
                "type": "integer",
                "description": "Max results to return. Default 20.",
            },
        },
        "required": [],
    },
}


CREATE_AGENT_JOB_TOOL = {
    "name": "create_agent_job",
    "description": (
        "Spawn a TARS coding agent to build, fix, or improve something in the TARS codebase. "
        "Use when Mike asks to add a feature, fix a bug, refactor code, or evolve TARS. "
        "Also use agent_type='release' when Mike explicitly says 'release' or 'deploy to production'. "
        "The agent works autonomously on the dev branch and creates a PR when done. "
        "Returns a job ID — always include the Agent Jobs link so Mike can watch the live stream."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "instruction": {
                "type": "string",
                "description": "Clear, specific task for the agent. Be precise about what to build/fix.",
            },
            "agent_type": {
                "type": "string",
                "enum": ["evolutionarist", "frontend", "backend", "sa", "release"],
                "description": "Agent type. Default 'evolutionarist' — it auto-routes to FE/BE/SA as needed.",
            },
        },
        "required": ["instruction"],
    },
}


GET_STRAVA_ACTIVITIES_TOOL = {
    "name": "get_strava_activities",
    "description": (
        "Fetch Mike's recent Strava activities (rides, runs, swims, walks, etc.). "
        "Use when Mike asks about his recent training, how far he rode, his last run, "
        "this week's rides, monthly training volume, or any activity data from Strava. "
        "Returns distance, duration, heart rate, elevation, suffer score, and activity IDs. "
        "Activity IDs can be passed to get_strava_activity for full details."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "limit": {
                "type": "integer",
                "description": "Number of activities per page (1–100). Default 10.",
            },
            "page": {
                "type": "integer",
                "description": "Starting page number. Default 1 (most recent). Use 2, 3, etc. to start further back.",
            },
            "num_pages": {
                "type": "integer",
                "description": (
                    "Number of consecutive pages to fetch and return as one combined list. "
                    "Default 1. Set to 500 with limit=100 to retrieve the full activity history — "
                    "fetching stops automatically when Strava returns an empty or partial page, "
                    "so there is no risk of over-fetching."
                ),
            },
            "before": {
                "type": "integer",
                "description": "Unix epoch timestamp. Only return activities that started before this time. Useful for querying a specific date range.",
            },
            "after": {
                "type": "integer",
                "description": "Unix epoch timestamp. Only return activities that started after this time. Useful for querying a specific date range.",
            },
            "sport_type": {
                "type": "string",
                "description": (
                    "Optional filter by sport type. Common values: Ride, Run, Swim, Walk, "
                    "VirtualRide, TrailRun, Hike. Omit to return all activity types."
                ),
            },
        },
        "required": [],
    },
}

GET_STRAVA_ACTIVITY_TOOL = {
    "name": "get_strava_activity",
    "description": (
        "Fetch full details of one specific Strava activity by ID. "
        "Use when Mike asks about a specific activity — calories burned, normalized power, "
        "cadence, device used, activity notes, or other details not in the activities list."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "activity_id": {
                "type": "integer",
                "description": "Strava activity ID — visible in get_strava_activities results or [STRAVA] context.",
            },
        },
        "required": ["activity_id"],
    },
}

GET_STRAVA_STATS_TOOL = {
    "name": "get_strava_stats",
    "description": (
        "Fetch Mike's Strava career and YTD training statistics: total distance, elevation, "
        "and moving time for rides and runs (recent 4 weeks, year-to-date, all-time). "
        "Use when Mike asks about his training volume, yearly totals, how much he's ridden this year, "
        "career mileage, or wants a high-level fitness overview."
    ),
    "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
    },
}

GET_STRAVA_ZONES_TOOL = {
    "name": "get_strava_zones",
    "description": (
        "Fetch Mike's heart rate and power training zones from Strava. "
        "Use when Mike asks about his HR zones, power zones, training thresholds, or FTP."
    ),
    "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
    },
}

GET_TESLA_STATUS_TOOL = {
    "name": "get_tesla_status",
    "description": (
        "Fetch the full real-time state of Mike's Tesla via Tessie. "
        "Returns: battery %, charging state, charging amps/kW, charge limit, estimated range, "
        "climate state (interior temp, HVAC on/off, seat heater levels, defrost), "
        "door/trunk/window lock state, sentry mode, valet mode, odometer, software version, "
        "GPS location, and whether the car is online/asleep. "
        "Use for ANY question about current Tesla state: charge level, range, temperature, "
        "is it locked, where is it, is it charging, battery health, software update, etc. "
        "Always call this before issuing commands that depend on current state."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "use_cache": {
                "type": "boolean",
                "description": "Use cached state (faster, default true). Set false to force a live fetch.",
            },
        },
        "required": [],
    },
}

TESLA_COMMAND_TOOL = {
    "name": "tesla_command",
    "description": (
        "Execute any command on Mike's Tesla via Tessie. "
        "Covers all vehicle controls: locks, climate, charging, trunks, windows, "
        "sentry mode, valet mode, lights, horn, HomeLink, remote start, sunroof, and more. "
        "\n\nAvailable commands:\n"
        "• LOCKS: lock, unlock\n"
        "• TRUNKS: activate_front_trunk, activate_rear_trunk, open_tonneau, close_tonneau\n"
        "• WINDOWS: vent_windows, close_windows\n"
        "• SUNROOF: vent_sunroof, close_sunroof\n"
        "• CLIMATE: start_climate, stop_climate, set_temperatures (temperature=°C), "
        "set_seat_heat (seat=0-5, level=0-3), set_seat_cool (seat=0-5, level=0-3), "
        "start_max_defrost, stop_max_defrost, "
        "start_steering_wheel_heater, stop_steering_wheel_heater, "
        "set_cabin_overheat_protection (on=true/false, fan_only=true/false), "
        "set_cop_temp (cop_temp=Low/Medium/High), "
        "set_bioweapon_mode (on=true/false), "
        "set_climate_keeper_mode (mode=off/keep/dog/camp)\n"
        "• CHARGING: start_charging, stop_charging, "
        "set_charge_limit (percent=50-100), "
        "set_charging_amps (amps=1-48), "
        "open_charge_port, close_charge_port\n"
        "• ALERTS: flash, honk\n"
        "• MODES: enable_sentry, disable_sentry, "
        "enable_valet, disable_valet, "
        "enable_low_power_mode, disable_low_power_mode, "
        "enable_keep_accessory_power_mode, disable_keep_accessory_power_mode\n"
        "• OTHER: wake (wake sleeping car), remote_start, trigger_homelink\n"
        "\nUse when Mike asks to lock/unlock, start climate, set a temperature, "
        "charge/stop charging, change charge limit, open trunk, honk, flash, "
        "enable sentry, or control any other vehicle feature."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "The command slug to execute (see list above).",
                "enum": [
                    "wake",
                    "lock", "unlock",
                    "activate_front_trunk", "activate_rear_trunk",
                    "open_tonneau", "close_tonneau",
                    "vent_windows", "close_windows",
                    "vent_sunroof", "close_sunroof",
                    "start_climate", "stop_climate",
                    "set_temperatures",
                    "set_seat_heat", "set_seat_cool",
                    "start_max_defrost", "stop_max_defrost",
                    "start_steering_wheel_heater", "stop_steering_wheel_heater",
                    "set_cabin_overheat_protection", "set_cop_temp",
                    "set_bioweapon_mode", "set_climate_keeper_mode",
                    "start_charging", "stop_charging",
                    "set_charge_limit", "set_charging_amps",
                    "open_charge_port", "close_charge_port",
                    "flash", "honk",
                    "trigger_homelink", "remote_start",
                    "enable_sentry", "disable_sentry",
                    "enable_valet", "disable_valet",
                    "enable_low_power_mode", "disable_low_power_mode",
                    "enable_keep_accessory_power_mode", "disable_keep_accessory_power_mode",
                ],
            },
            "temperature": {
                "type": "number",
                "description": "Target cabin temperature in °C. Required for set_temperatures.",
            },
            "seat": {
                "type": "integer",
                "description": "Seat index for set_seat_heat/cool: 0=driver, 1=passenger, 2=rear-left, 3=rear-center, 4=rear-right, 5=third-row.",
            },
            "level": {
                "type": "integer",
                "description": "Heat/cool level: 0=off, 1=low, 2=medium, 3=high.",
            },
            "percent": {
                "type": "integer",
                "description": "Charge limit percentage (50–100). Required for set_charge_limit.",
            },
            "amps": {
                "type": "integer",
                "description": "Charging current in amps (1–48). Required for set_charging_amps.",
            },
            "on": {
                "type": "boolean",
                "description": "Enable (true) or disable (false). Used by set_cabin_overheat_protection, set_bioweapon_mode.",
            },
            "fan_only": {
                "type": "boolean",
                "description": "Fan-only mode for cabin overheat protection (no AC).",
            },
            "cop_temp": {
                "type": "string",
                "enum": ["Low", "Medium", "High"],
                "description": "Cabin overheat protection threshold. Used by set_cop_temp.",
            },
            "mode": {
                "type": "string",
                "enum": ["off", "keep", "dog", "camp"],
                "description": "Climate keeper mode. Used by set_climate_keeper_mode.",
            },
        },
        "required": ["command"],
    },
}

GET_TESLA_SESSIONS_TOOL = {
    "name": "get_tesla_sessions",
    "description": (
        "Fetch Tesla drive and charging history via Tessie. "
        "Use data_type='drives' for trip history (distance, duration, energy used, start/end locations). "
        "Use data_type='charges' for charging sessions (kWh added, charge time, start/end SOC, cost, location). "
        "Use data_type='battery_health' for degradation over time. "
        "Use when Mike asks about recent trips, how much he drove, charging history, "
        "energy costs, range stats, or battery degradation."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "data_type": {
                "type": "string",
                "enum": ["drives", "charges", "battery_health"],
                "description": "What to fetch: drives, charges, or battery health over time.",
            },
            "limit": {
                "type": "integer",
                "description": "Number of records to return (1–100). Default 10.",
            },
            "from_ts": {
                "type": "string",
                "description": "ISO 8601 start timestamp for filtering (e.g. '2025-01-01T00:00:00').",
            },
            "to_ts": {
                "type": "string",
                "description": "ISO 8601 end timestamp for filtering.",
            },
            "superchargers_only": {
                "type": "boolean",
                "description": "For charges: only return Supercharger sessions.",
            },
        },
        "required": ["data_type"],
    },
}

GET_CURRENT_TIME_TOOL = {
    "name": "get_current_time",
    "description": (
        "Returns the current date and time in the user's local timezone and as UTC ISO 8601. "
        "Call this before computing any time-relative value — due dates ('in 2 hours', 'next Monday'), "
        "event scheduling, countdowns, or whenever the user asks what time or date it is. "
        "Never rely on training data for the current time."
    ),
    "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
    },
}

GENERATE_CHART_TOOL = {
    "name": "generate_chart",
    "description": (
        "Generate any chart, graph, or data visualization and display it inline in the chat. "
        "ALWAYS use this tool when asked to plot, chart, graph, or visualize anything — never refuse. "
        "The server has matplotlib, seaborn, numpy, and pandas fully installed and ready. "
        "Write Python code using those libraries to BUILD the figure only. "
        "Do NOT call plt.savefig(), plt.show(), or plt.close() — the server saves and renders the "
        "figure automatically. Call plt.tight_layout() at the end. "
        "CRITICAL: The code runs in an isolated subprocess. ALL data must be defined as Python "
        "literals inside the code — never reference external variables like `activities`, `df`, "
        "or any name from the conversation context. Embed the actual values directly in the code. "
        "The chart will render immediately in the chat."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Short descriptive title for the chart.",
            },
            "code": {
                "type": "string",
                "description": (
                    "Complete Python code to BUILD the chart using matplotlib/seaborn/numpy/pandas. "
                    "Do NOT call plt.savefig(), plt.show(), or plt.close() — the server handles "
                    "saving and rendering. End with plt.tight_layout()."
                ),
            },
        },
        "required": ["title", "code"],
    },
}

REQUEST_ESCALATION_TOOL = {
    "name": "request_escalation",
    "description": (
        "Signal that this task requires a more capable tier. "
        "Call this BEFORE generating any response text. "
        "The harness will re-run the full request at Tier 3 automatically. "
        "Use only when the task genuinely exceeds your current tier — "
        "never for simple lookups or single tool calls."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "reason": {
                "type": "string",
                "description": "Why this task needs a higher tier.",
            }
        },
        "required": ["reason"],
    },
}


# ─── Provider / model config ──────────────────────────────────────────────────

_ZAI_MODELS = {
    # Free text models (Anthropic-compatible endpoint)
    "glm-4.5-flash":       "glm-4.5-flash",
    "glm-4.7-flash":       "glm-4.7-flash",
    # Budget / standard text (Anthropic-compatible endpoint)
    "glm-4-32b-0414-128k": "glm-4-32b-0414-128k",
    "glm-4.5-airx":        "glm-4.5-airx",
    "glm-4.7-flashx":      "glm-4.7-flashx",
    "glm-4.5-air":         "glm-4.5-air",
    "glm-4.5":             "glm-4.5",
    "glm-4.5-x":           "glm-4.5-x",
    "glm-4.6":             "glm-4.6",
    "glm-4.7":             "glm-4.7",
    # Frontier text (OpenAI-compatible endpoint)
    "glm-5":               "glm-5",
    "glm-5-turbo":         "glm-5-turbo",
    "glm-5.1":             "glm-5.1",
    # Vision — GLM-4.x via Anthropic endpoint, GLM-5.x via OpenAI endpoint
    "glm-4.6v-flash":      "glm-4.6v-flash",    # free
    "glm-4.6v-flashx":     "glm-4.6v-flashx",
    "glm-4.5v":            "glm-4.5v",
    "glm-4.6v":            "glm-4.6v",
    "glm-5v-turbo":        "glm-5v-turbo",       # OpenAI endpoint
}

_PROVIDER_DEFAULTS = {
    # (provider, tier) → default model name
    ("anthropic", "tier1"): "claude-haiku-4-5-20251001",
    ("anthropic", "tier2"): None,              # None → no override; uses model_override if set
    ("anthropic", "tier3"): "claude-sonnet-4-6",
    ("anthropic", "vision"): "claude-sonnet-4-6",
    ("zai",       "tier1"): "glm-4.5-flash",   # free
    ("zai",       "tier2"): "glm-4.7",
    ("zai",       "tier3"): "glm-5.1",
    ("zai",       "vision"): "glm-5v-turbo",   # OpenAI endpoint
}


def _is_openai_path(model: Optional[str]) -> bool:
    """GLM-5.x and glm-5v-turbo must use Z.ai's OpenAI-compatible endpoint."""
    return bool(model) and (model.startswith("glm-5") or model == "glm-5v-turbo")


class ModelClient:
    def __init__(self):
        self._anthropic: Optional[anthropic.AsyncAnthropic] = None
        self._zai: Optional[anthropic.AsyncAnthropic] = None
        self._zai_openai = None   # openai.AsyncOpenAI, lazy-init

    @property
    def anthropic(self) -> anthropic.AsyncAnthropic:
        if not self._anthropic:
            self._anthropic = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        return self._anthropic

    @property
    def zai(self):  # -> AsyncAnthropic (string to avoid shadowing the module import)
        """Z.ai Anthropic-compatible client for GLM-4.x models."""
        if not self._zai:
            import anthropic as _anthropic  # re-import in local scope to avoid shadowing
            self._zai = _anthropic.AsyncAnthropic(
                api_key=settings.zai_api_key,
                base_url=settings.zai_base_url,
            )
        return self._zai

    @property
    def zai_openai(self):
        """Z.ai OpenAI-compatible client for GLM-5.x and glm-5v-turbo."""
        if not self._zai_openai:
            from openai import AsyncOpenAI
            self._zai_openai = AsyncOpenAI(
                api_key=settings.zai_api_key,
                base_url=settings.zai_openai_base_url,
            )
        return self._zai_openai

    def _client_for(self, provider: str):
        return self.zai if provider == "zai" else self.anthropic

    def reset(self) -> None:
        """Clear cached clients so next call picks up updated API keys/config."""
        self._anthropic = None
        self._zai = None
        self._zai_openai = None
        logger.info("ModelClient reset — API clients will re-initialise on next request")

    def _resolve_model(self, tier_key: str, provider: str) -> Optional[str]:
        """Return the effective model name for a tier+provider combination."""
        override = getattr(settings, f"{tier_key}_model_override", "")
        if override:
            return override
        return _PROVIDER_DEFAULTS.get((provider, tier_key))

    def _has_image_content(self, messages: list) -> bool:
        """True when any message contains an Anthropic-format image block."""
        for m in messages:
            content = m.get("content")
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "image":
                        return True
        return False

    async def stream(
        self,
        messages: List[Dict[str, str]],
        tier: ModelTier,
        system: str = "",
        max_tokens: int = 4096,
        tools: Optional[List[Dict]] = None,
        tool_executor=None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        # ── Vision: image blocks present — route to dedicated vision model ────
        if self._has_image_content(messages):
            if settings.vision_provider:
                _vp = settings.vision_provider
            elif settings.anthropic_api_key:
                # Default to Anthropic for vision; Z.ai vision requires explicit opt-in
                _vp = "anthropic"
            else:
                _vp = settings.tier3_provider
            _vm = settings.vision_model_override or self._resolve_model("vision", _vp)
            logger.info("Vision content detected — routing to %s (%s)", _vp, _vm)
            if _vp == "zai":
                # Z.ai vision (glm-5v-turbo) requires the OpenAI-compatible endpoint
                _vm = _vm or "glm-5v-turbo"
                async for event in self._stream_openai(
                    messages, system, max_tokens,
                    model=_vm, tools=tools, tool_executor=tool_executor,
                ):
                    yield event
            else:
                async for event in self._stream_anthropic(
                    messages, system, max_tokens,
                    model=_vm, tools=tools, tool_executor=tool_executor,
                    client=self._client_for(_vp),
                ):
                    yield event
            return

        # ── Tier 3: frontier model ────────────────────────────────────────────
        if tier == ModelTier.TIER3:
            provider3 = settings.tier3_provider
            model3 = self._resolve_model("tier3", provider3)
            if provider3 == "zai" and _is_openai_path(model3):
                logger.info("Tier3 routed to Z.ai OpenAI endpoint (%s)", model3)
                async for event in self._stream_openai(
                    messages, system, max_tokens,
                    model=model3, tools=tools, tool_executor=tool_executor,
                ):
                    yield event
            else:
                async for event in self._stream_anthropic(
                    messages, system, max_tokens,
                    model=model3, tools=tools, tool_executor=tool_executor,
                    client=self._client_for(provider3),
                ):
                    yield event
            return

        # ── Tier 1: fast model — always available, no cold start ─────────────
        if tier == ModelTier.TIER1:
            provider1 = settings.tier1_provider
            model1 = self._resolve_model("tier1", provider1) or settings.tier1_model
            async for event in self._stream_anthropic(
                messages, system, min(max_tokens, 1024),
                model=model1, client=self._client_for(provider1),
                tools=tools, tool_executor=tool_executor,
            ):
                yield event
            return

        # ── Tier 2: workhorse ─────────────────────────────────────────────────
        provider2 = settings.tier2_provider
        model2 = self._resolve_model("tier2", provider2) or "glm-4.7"
        if provider2 == "zai" and _is_openai_path(model2):
            logger.info("Tier2 routed to Z.ai OpenAI endpoint (%s)", model2)
            async for event in self._stream_openai(
                messages, system, max_tokens,
                model=model2, tools=tools, tool_executor=tool_executor,
            ):
                yield event
        else:
            client2 = self._client_for(provider2)
            logger.info("Tier2 routed to %s (%s)", provider2, model2)
            async for event in self._stream_anthropic(
                messages, system, max_tokens,
                model=model2, client=client2, tools=tools, tool_executor=tool_executor,
            ):
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
        client: Optional[anthropic.AsyncAnthropic] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        # Tools that emit a suggestion chip — user confirms before action
        _SUGGESTION_TOOLS = {"propose_calendar_event", "propose_task"}

        # Use provided client (e.g. z.ai) or fall back to the default Anthropic client
        _client = client if client is not None else self.anthropic
        _is_zai = _client is not self.anthropic  # Z.ai doesn't support cache_control
        model = model or "claude-sonnet-4-6"
        current_messages = list(messages)
        total_input = 0
        total_output = 0

        try:
            for _round in range(8):  # max 8 tool-call rounds before giving up
                # Prompt caching: mark system prompt as ephemeral on Anthropic path
                # so turns 2+ pay only 10% of input tokens for the (static) system prompt.
                # Z.ai / GLM don't support cache_control — omit it there.
                if system and not _is_zai:
                    system_param = [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]
                else:
                    system_param = system

                kwargs: Dict[str, Any] = dict(
                    model=model,
                    max_tokens=max_tokens,
                    system=system_param,
                    messages=current_messages,
                )
                if tools:
                    kwargs["tools"] = tools

                async with _client.messages.stream(**kwargs) as stream:
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

                    # Escalation: if any tool call is request_escalation, signal and stop
                    for b in tool_uses:
                        if b.name == "request_escalation":
                            yield {"type": "escalation_requested", "reason": b.input.get("reason", "")}
                            return

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

    # ─── OpenAI-compatible path (GLM-5.x, glm-5v-turbo) ─────────────────────────

    @staticmethod
    def _to_openai_tools(tools: List[Dict]) -> List[Dict]:
        """Convert Anthropic tool definitions to OpenAI function format."""
        return [
            {
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "parameters": t.get("input_schema", {}),
                },
            }
            for t in tools
        ]

    @staticmethod
    def _to_openai_messages(messages: List[Dict], system: str = "") -> List[Dict]:
        """
        Convert Anthropic-format message list to OpenAI format.

        Handles:
        - Plain string content → unchanged
        - User messages with image blocks → image_url content items
        - Assistant messages with tool_use blocks → tool_calls
        - User messages with tool_result blocks → role:tool messages
        """
        result: List[Dict] = []
        if system:
            result.append({"role": "system", "content": system})

        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content")

            # Simple string — pass through as-is
            if isinstance(content, str):
                result.append({"role": role, "content": content})
                continue

            if not isinstance(content, list):
                result.append({"role": role, "content": str(content) if content else ""})
                continue

            # User message containing tool_result blocks → one "tool" message per result
            if role == "user" and content and all(
                isinstance(b, dict) and b.get("type") == "tool_result" for b in content
            ):
                for block in content:
                    raw = block.get("content", "")
                    if isinstance(raw, list):
                        raw = " ".join(b.get("text", "") for b in raw if isinstance(b, dict))
                    result.append({
                        "role": "tool",
                        "tool_call_id": block.get("tool_use_id", ""),
                        "content": str(raw),
                    })
                continue

            # Assistant message — may have text + tool_use blocks
            if role == "assistant":
                text_parts: List[str] = []
                tool_calls: List[Dict] = []
                for block in content:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") == "text":
                        text_parts.append(block.get("text", ""))
                    elif block.get("type") == "tool_use":
                        tool_calls.append({
                            "id": block.get("id", ""),
                            "type": "function",
                            "function": {
                                "name": block.get("name", ""),
                                "arguments": json.dumps(block.get("input", {})),
                            },
                        })
                out: Dict = {"role": "assistant", "content": "\n".join(text_parts) or ""}
                if tool_calls:
                    out["tool_calls"] = tool_calls
                result.append(out)
                continue

            # User message with mixed text + image blocks
            oai_content: List[Dict] = []
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "text":
                    oai_content.append({"type": "text", "text": block.get("text", "")})
                elif block.get("type") == "image":
                    src = block.get("source", {})
                    if src.get("type") == "base64":
                        url = f"data:{src['media_type']};base64,{src['data']}"
                    else:
                        url = src.get("url", "")
                    oai_content.append({"type": "image_url", "image_url": {"url": url}})
            result.append({"role": role, "content": oai_content or ""})

        return result

    async def _stream_openai(
        self,
        messages: List[Dict],
        system: str,
        max_tokens: int,
        *,
        model: str,
        tools: Optional[List[Dict]] = None,
        tool_executor=None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Stream via Z.ai's OpenAI-compatible endpoint (GLM-5.x and glm-5v-turbo)."""
        _SUGGESTION_TOOLS = {"propose_calendar_event", "propose_task"}

        # GLM-5.x uses a thinking phase that consumes tokens before the actual response.
        # Ensure we have enough headroom (8192 minimum) so thinking doesn't exhaust the budget.
        effective_max_tokens = max(max_tokens, 8192)

        current_messages = self._to_openai_messages(messages, system)
        oai_tools = self._to_openai_tools(tools) if tools else None
        total_tokens = 0

        try:
            for _round in range(8):
                kwargs: Dict[str, Any] = dict(
                    model=model,
                    max_tokens=effective_max_tokens,
                    messages=current_messages,
                    stream=True,
                )
                if oai_tools:
                    kwargs["tools"] = oai_tools

                # Accumulate streaming chunks
                accumulated_text = ""
                accumulated_tcs: Dict[int, Dict] = {}  # index → {id, name, arguments}
                finish_reason: Optional[str] = None

                stream = await self.zai_openai.chat.completions.create(**kwargs)
                async for chunk in stream:
                    if not chunk.choices:
                        # usage-only chunk that some providers emit at end
                        if hasattr(chunk, "usage") and chunk.usage:
                            total_tokens += (chunk.usage.total_tokens or 0)
                        continue

                    choice = chunk.choices[0]
                    if choice.finish_reason:
                        finish_reason = choice.finish_reason

                    delta = choice.delta

                    if delta.content:
                        accumulated_text += delta.content
                        yield {"type": "chunk", "text": delta.content}

                    if delta.tool_calls:
                        for tc in delta.tool_calls:
                            idx = tc.index
                            if idx not in accumulated_tcs:
                                accumulated_tcs[idx] = {"id": "", "name": "", "arguments": ""}
                            if tc.id:
                                accumulated_tcs[idx]["id"] = tc.id
                            if tc.function:
                                if tc.function.name:
                                    accumulated_tcs[idx]["name"] += tc.function.name
                                if tc.function.arguments:
                                    accumulated_tcs[idx]["arguments"] += tc.function.arguments

                if finish_reason != "tool_calls" or not accumulated_tcs:
                    if finish_reason == "length" and not accumulated_text:
                        # Thinking phase exhausted the token budget before generating a response.
                        # This shouldn't happen with effective_max_tokens=8192, but guard it anyway.
                        logger.warning("OpenAI path: %s exhausted tokens during thinking (max=%d)", model, effective_max_tokens)
                        yield {"type": "chunk", "text": "*(Response truncated — the model exhausted its token budget during reasoning. Try a shorter or simpler request.)*"}
                    yield {"type": "done", "model": model, "tokens": total_tokens}
                    return

                # Parse tool calls and emit suggestion events
                tool_uses = []
                for idx in sorted(accumulated_tcs.keys()):
                    tc = accumulated_tcs[idx]
                    try:
                        inp = json.loads(tc["arguments"]) if tc["arguments"] else {}
                    except json.JSONDecodeError:
                        inp = {}
                    tool_uses.append({"id": tc["id"], "name": tc["name"], "input": inp})

                for tu in tool_uses:
                    if tu["name"] == "propose_calendar_event":
                        yield {"type": "calendar_suggest", "tool_use_id": tu["id"], **tu["input"]}
                    elif tu["name"] == "propose_task":
                        yield {"type": "task_suggest", "tool_use_id": tu["id"], **tu["input"]}

                # Escalation: if any tool call is request_escalation, signal and stop
                for tu in tool_uses:
                    if tu["name"] == "request_escalation":
                        yield {"type": "escalation_requested", "reason": tu["input"].get("reason", "")}
                        return

                # Build assistant turn + tool results, then loop
                asst: Dict = {
                    "role": "assistant",
                    "content": accumulated_text or "",
                    "tool_calls": [
                        {
                            "id": tu["id"],
                            "type": "function",
                            "function": {
                                "name": tu["name"],
                                "arguments": json.dumps(tu["input"]),
                            },
                        }
                        for tu in tool_uses
                    ],
                }

                tool_results: List[Dict] = []
                for tu in tool_uses:
                    if tu["name"] in _SUGGESTION_TOOLS:
                        result_str = "Suggestion shown to user."
                    elif tool_executor is not None:
                        try:
                            result_str = await tool_executor(tu["name"], tu["input"])
                        except Exception as exc:
                            result_str = f"Tool error ({tu['name']}): {exc}"
                    else:
                        result_str = "Action completed."
                    tool_results.append({
                        "role": "tool",
                        "tool_call_id": tu["id"],
                        "content": str(result_str),
                    })

                current_messages = current_messages + [asst] + tool_results

            yield {"type": "done", "model": model, "tokens": total_tokens}

        except Exception as e:
            logger.error("OpenAI path error (model=%s): %s", model, e)
            yield {"type": "error", "error": str(e)}


# App-level singleton
_client: Optional[ModelClient] = None


def get_model_client() -> ModelClient:
    global _client
    if not _client:
        _client = ModelClient()
    return _client
