"""
Unified model client.

Tier 1: Claude Haiku  — always available, ~200-500ms, cheap (~$0.001/req)
Tier 2: RunPod        — GPU inference via RunPod Serverless; model set by WORKHORSE_MODEL env var
         cold fallback: Haiku  if message ≤ 500 chars (standard tasks)
                        Sonnet if message > 500 chars or contains complexity signals
Tier 3: Claude Sonnet — frontier, tools, streaming, always Claude

NOTE: Ollama is fully retired. The classifier is a Haiku API call (router.py).
"""

from __future__ import annotations  # makes all annotations lazy — avoids 'anthropic' property shadowing the module

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
                    "Default 1. Use with limit=100 to retrieve large chunks of history — "
                    "e.g. num_pages=6 with limit=100 returns up to 600 activities. "
                    "Stop condition: if a page returns fewer than limit items, fetching stops early."
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

GENERATE_CHART_TOOL = {
    "name": "generate_chart",
    "description": (
        "Generate any chart, graph, or data visualization and display it inline in the chat. "
        "ALWAYS use this tool when asked to plot, chart, graph, or visualize anything — never refuse. "
        "The server has matplotlib, seaborn, numpy, and pandas fully installed and ready. "
        "Write Python code using those libraries. The variable `output_path` is pre-defined — "
        "save the figure with plt.savefig(output_path) or fig.savefig(output_path). "
        "The chart will render immediately in the chat. Always call plt.tight_layout() before saving."
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
                    "Complete Python code to generate the chart using matplotlib/seaborn/numpy/pandas. "
                    "The variable `output_path` is already defined — do not reassign it. "
                    "End with: plt.tight_layout(); plt.savefig(output_path); plt.close('all')"
                ),
            },
        },
        "required": ["title", "code"],
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


_ZAI_MODELS = {
    "glm-4.5-air": "glm-4.5-air",
    "glm-4.5":     "glm-4.5",
    "glm-4.6":     "glm-4.6",
    "glm-4.7":     "glm-4.7",
}

_PROVIDER_DEFAULTS = {
    # (provider, tier) → default model name
    ("anthropic", "tier1"): "claude-haiku-4-5-20251001",
    ("anthropic", "tier2"): None,              # None → use existing RunPod/fallback logic
    ("anthropic", "tier3"): "claude-sonnet-4-6",
    ("zai",       "tier1"): "glm-4.5-air",
    ("zai",       "tier2"): "glm-4.6",
    ("zai",       "tier3"): "glm-4.7",
}


class ModelClient:
    def __init__(self):
        self._anthropic: Optional[anthropic.AsyncAnthropic] = None
        self._zai: Optional[anthropic.AsyncAnthropic] = None
        self._failed_at: dict[ModelTier, Optional[float]] = {
            ModelTier.TIER2: None,
        }

    @property
    def anthropic(self) -> anthropic.AsyncAnthropic:
        if not self._anthropic:
            self._anthropic = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        return self._anthropic

    @property
    def zai(self):  # -> AsyncAnthropic (string to avoid shadowing the module import)
        """Z.ai Anthropic-compatible client (GLM models)."""
        if not self._zai:
            import anthropic as _anthropic  # re-import in local scope to avoid shadowing
            self._zai = _anthropic.AsyncAnthropic(
                api_key=settings.zai_api_key,
                base_url=settings.zai_base_url,
            )
        return self._zai

    def _client_for(self, provider: str):
        return self.zai if provider == "zai" else self.anthropic

    def reset(self) -> None:
        """Clear cached clients so next call picks up updated API keys/config."""
        self._anthropic = None
        self._zai = None
        logger.info("ModelClient reset — API clients will re-initialise on next request")

    def _resolve_model(self, tier_key: str, provider: str) -> Optional[str]:
        """Return the effective model name for a tier+provider combination."""
        override = getattr(settings, f"{tier_key}_model_override", "")
        if override:
            return override
        return _PROVIDER_DEFAULTS.get((provider, tier_key))

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
        # ── Tier 3: frontier model ────────────────────────────────────────────
        if tier == ModelTier.TIER3:
            provider3 = settings.tier3_provider
            model3 = self._resolve_model("tier3", provider3)
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
            ):
                yield event
            return

        # ── Tier 2: workhorse — RunPod if provider=anthropic, else Z.ai ───────
        provider2 = settings.tier2_provider
        if provider2 == "zai":
            model2 = self._resolve_model("tier2", "zai") or "glm-4.6"
            logger.info("Tier2 routed to Z.ai (%s)", model2)
            async for event in self._stream_anthropic(
                messages, system, max_tokens,
                model=model2, client=self.zai, tools=tools, tool_executor=tool_executor,
            ):
                yield event
            return

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
