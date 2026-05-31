"""
Gmail connector — read threads, fetch full messages, send emails.
"""

import base64
import logging
from email import message_from_bytes
from email.mime.text import MIMEText
from typing import List, Optional

from googleapiclient.discovery import build
from google.auth.transport.requests import Request

from connectors.google_oauth import credentials_from_auth

log = logging.getLogger(__name__)


class GmailClient:
    def __init__(self, auth: dict):
        creds = credentials_from_auth(auth)
        if not creds:
            raise ValueError("No valid Gmail credentials")
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
        self._service = build("gmail", "v1", credentials=creds, cache_discovery=False)

    def list_threads(self, query: str = "", max_results: int = 20) -> List[dict]:
        result = (
            self._service.users()
            .threads()
            .list(userId="me", q=query, maxResults=max_results)
            .execute()
        )
        return result.get("threads", [])

    def get_thread(self, thread_id: str) -> dict:
        return (
            self._service.users()
            .threads()
            .get(userId="me", id=thread_id, format="full")
            .execute()
        )

    def get_message(self, message_id: str) -> dict:
        return (
            self._service.users()
            .messages()
            .get(userId="me", id=message_id, format="full")
            .execute()
        )

    def list_recent_unread(self, max_results: int = 20) -> List[dict]:
        return self.list_threads(query="is:unread", max_results=max_results)

    def list_since(self, after_epoch: int, max_results: int = 50) -> List[dict]:
        return self.list_threads(query=f"after:{after_epoch}", max_results=max_results)

    def get_inbox_summary(self, max_threads: int = 12) -> List[dict]:
        """Compact inbox summary for context injection — metadata only, no bodies."""
        threads = self.list_threads(query="in:inbox", max_results=max_threads)
        summaries = []
        for t in threads:
            try:
                data = (
                    self._service.users()
                    .threads()
                    .get(userId="me", id=t["id"], format="metadata",
                         metadataHeaders=["Subject", "From", "Date"])
                    .execute()
                )
                msgs = data.get("messages", [])
                if not msgs:
                    continue
                latest = msgs[-1]
                headers = {h["name"]: h["value"] for h in latest.get("payload", {}).get("headers", [])}
                from_raw = headers.get("From", "")
                from_name = from_raw.split("<")[0].strip().strip('"') or from_raw
                summaries.append({
                    "subject":   headers.get("Subject", "(no subject)"),
                    "from_name": from_name,
                    "date":      headers.get("Date", ""),
                    "snippet":   data.get("snippet", ""),
                    "unread":    "UNREAD" in latest.get("labelIds", []),
                    "thread_id": t["id"],
                })
            except Exception as exc:
                log.debug("Thread metadata fetch failed %s: %s", t["id"], exc)
        return summaries


    def send_email(
        self,
        to: str,
        subject: str,
        body: str,
        cc: Optional[str] = None,
        thread_id: Optional[str] = None,
    ) -> str:
        """Send an email (or reply to a thread). Returns a confirmation string."""
        msg = MIMEText(body, "plain", "utf-8")
        msg["to"] = to
        msg["subject"] = subject
        if cc:
            msg["cc"] = cc

        # For replies: fetch In-Reply-To / References from the last message in the thread
        if thread_id:
            try:
                thread_data = (
                    self._service.users()
                    .threads()
                    .get(userId="me", id=thread_id, format="metadata",
                         metadataHeaders=["Message-ID", "Subject"])
                    .execute()
                )
                messages = thread_data.get("messages", [])
                if messages:
                    last_headers = {
                        h["name"]: h["value"]
                        for h in messages[-1].get("payload", {}).get("headers", [])
                    }
                    mid = last_headers.get("Message-ID", "")
                    if mid:
                        msg["In-Reply-To"] = mid
                        msg["References"] = mid
            except Exception as exc:
                log.debug("Could not fetch thread headers for reply: %s", exc)

        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")
        send_body: dict = {"raw": raw}
        if thread_id:
            send_body["threadId"] = thread_id

        result = (
            self._service.users()
            .messages()
            .send(userId="me", body=send_body)
            .execute()
        )
        return f"Email sent to {to} (id: {result.get('id', '?')})."


def extract_thread_text(thread: dict) -> str:
    """Pull plain-text body from all messages in a thread."""
    parts = []
    for msg in thread.get("messages", []):
        headers = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
        subject = headers.get("Subject", "")
        sender = headers.get("From", "")
        text = _extract_body(msg.get("payload", {}))
        if text:
            parts.append(f"From: {sender}\nSubject: {subject}\n\n{text}")
    return "\n\n---\n\n".join(parts)


def _extract_body(payload: dict) -> str:
    mime = payload.get("mimeType", "")
    if mime == "text/plain":
        data = payload.get("body", {}).get("data", "")
        return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace") if data else ""

    for part in payload.get("parts", []):
        text = _extract_body(part)
        if text:
            return text
    return ""
