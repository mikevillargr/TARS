"""
Google Workspace connector — read & write Google Docs, Sheets, and Slides by link.

Reading: Drive's files.export converts native Google files to Office formats that
TARS already knows how to parse (Doc→docx, Sheet→xlsx, Slides→pptx). Non-native
files (PDFs etc. uploaded to Drive) are fetched with files.get_media. The exported
bytes flow straight into the existing ingest pipeline / parsers — no new parser code.

Writing: Docs/Sheets/Slides each get a thin write surface (append text, update
cells, create new) via their respective REST APIs.
"""

import io
import logging
import re
from typing import Optional, Tuple

from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

from connectors.google_oauth import credentials_from_auth

log = logging.getLogger(__name__)


# ── Native Google MIME → Office export MIME + extension ─────────────────────────
_EXPORT_MAP = {
    "application/vnd.google-apps.document": (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "docx",
    ),
    "application/vnd.google-apps.spreadsheet": (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xlsx",
    ),
    "application/vnd.google-apps.presentation": (
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "pptx",
    ),
}

# host check
_GOOGLE_HOSTS = ("docs.google.com", "drive.google.com", "sheets.google.com")

# file-id extraction patterns, tried in order
_ID_PATTERNS = [
    re.compile(r"/(?:document|spreadsheets|presentation|file)/d/([a-zA-Z0-9_-]+)"),
    re.compile(r"[?&]id=([a-zA-Z0-9_-]+)"),
]


def is_google_workspace_url(url: str) -> bool:
    """True for any docs.google.com / drive.google.com link we can ingest."""
    if not url:
        return False
    return any(h in url for h in _GOOGLE_HOSTS)


def parse_file_id(url: str) -> Optional[str]:
    """Extract the Drive file ID from a share/edit URL. None if not parseable."""
    for pat in _ID_PATTERNS:
        m = pat.search(url)
        if m:
            return m.group(1)
    return None


def extract_workspace_urls(text: str) -> list[str]:
    """Find all Google Docs/Sheets/Slides/Drive links in a blob of text."""
    if not text:
        return []
    raw = re.findall(r"https?://(?:docs|drive|sheets)\.google\.com/[^\s)>\]\"']+", text)
    # dedupe by file id (same doc may appear with different #gid / query strings)
    seen: dict[str, str] = {}
    for u in raw:
        fid = parse_file_id(u)
        key = fid or u
        seen.setdefault(key, u)
    return list(seen.values())


class GoogleWorkspaceClient:
    """Drive + Docs + Sheets + Slides, lazily built from a stored OAuth auth dict."""

    def __init__(self, auth: dict):
        creds = credentials_from_auth(auth)
        if not creds:
            raise ValueError("No valid Google Workspace credentials")
        self._creds = creds
        self._drive = None
        self._docs = None
        self._sheets = None
        self._slides = None

    # ── service accessors ──────────────────────────────────────────────────────
    @property
    def drive(self):
        if self._drive is None:
            self._drive = build("drive", "v3", credentials=self._creds, cache_discovery=False)
        return self._drive

    @property
    def docs(self):
        if self._docs is None:
            self._docs = build("docs", "v1", credentials=self._creds, cache_discovery=False)
        return self._docs

    @property
    def sheets(self):
        if self._sheets is None:
            self._sheets = build("sheets", "v4", credentials=self._creds, cache_discovery=False)
        return self._sheets

    @property
    def slides(self):
        if self._slides is None:
            self._slides = build("slides", "v1", credentials=self._creds, cache_discovery=False)
        return self._slides

    # ── metadata ────────────────────────────────────────────────────────────────
    def get_metadata(self, file_id: str) -> dict:
        return self.drive.files().get(
            fileId=file_id,
            fields="id, name, mimeType, modifiedTime, owners, webViewLink",
            supportsAllDrives=True,
        ).execute()

    # ── read: download as parseable bytes ──────────────────────────────────────
    def fetch_as_file(self, file_id: str) -> Tuple[bytes, str, str]:
        """
        Return (content_bytes, filename, mime_type) ready for ingest.ingest_file().

        Native Google files are exported to Office formats; everything else is
        downloaded as-is. The filename's extension drives parser routing downstream.
        """
        meta = self.get_metadata(file_id)
        name = meta.get("name", file_id)
        mime = meta.get("mimeType", "")

        if mime in _EXPORT_MAP:
            export_mime, ext = _EXPORT_MAP[mime]
            request = self.drive.files().export_media(fileId=file_id, mimeType=export_mime)
            filename = f"{name}.{ext}"
            out_mime = export_mime
        else:
            request = self.drive.files().get_media(fileId=file_id, supportsAllDrives=True)
            filename = name
            out_mime = mime

        buf = io.BytesIO()
        downloader = MediaIoBaseDownload(buf, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        return buf.getvalue(), filename, out_mime

    # ── write: Docs ─────────────────────────────────────────────────────────────
    def append_to_doc(self, file_id: str, text: str) -> dict:
        """Append plain text to the end of a Google Doc."""
        doc = self.docs.documents().get(documentId=file_id).execute()
        # end index of body content; insert just before the final newline
        end_index = doc["body"]["content"][-1]["endIndex"] - 1
        self.docs.documents().batchUpdate(
            documentId=file_id,
            body={"requests": [{
                "insertText": {"location": {"index": end_index}, "text": "\n" + text}
            }]},
        ).execute()
        return {"file_id": file_id, "appended_chars": len(text)}

    def create_doc(self, title: str, body_text: str = "") -> dict:
        """Create a new Google Doc, optionally with initial body text."""
        created = self.docs.documents().create(body={"title": title}).execute()
        doc_id = created["documentId"]
        if body_text:
            self.docs.documents().batchUpdate(
                documentId=doc_id,
                body={"requests": [{"insertText": {"location": {"index": 1}, "text": body_text}}]},
            ).execute()
        return {
            "file_id": doc_id,
            "title": title,
            "url": f"https://docs.google.com/document/d/{doc_id}/edit",
        }

    # ── write: Sheets ────────────────────────────────────────────────────────────
    def update_sheet(self, file_id: str, range_a1: str, values: list[list]) -> dict:
        """Overwrite a range (A1 notation) with a 2-D array of values."""
        self.sheets.spreadsheets().values().update(
            spreadsheetId=file_id,
            range=range_a1,
            valueInputOption="USER_ENTERED",
            body={"values": values},
        ).execute()
        return {"file_id": file_id, "range": range_a1, "rows": len(values)}

    def append_sheet_rows(self, file_id: str, range_a1: str, values: list[list]) -> dict:
        """Append rows below the existing data in a sheet/range."""
        self.sheets.spreadsheets().values().append(
            spreadsheetId=file_id,
            range=range_a1,
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body={"values": values},
        ).execute()
        return {"file_id": file_id, "range": range_a1, "rows": len(values)}

    def read_sheet(self, file_id: str, range_a1: str = "A1:Z1000") -> list[list]:
        """Read a range from a sheet as a 2-D array (for live tool reads)."""
        result = self.sheets.spreadsheets().values().get(
            spreadsheetId=file_id, range=range_a1,
        ).execute()
        return result.get("values", [])
