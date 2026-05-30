"""
Google People connector — read/write contacts, search, otherContacts, directory.

The People API does NOT support push notifications, so we rely on sync tokens
returned by people.connections.list for efficient incremental polling
(see jobs/people_sync.py).
"""

import logging
from typing import List, Optional, Tuple

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from google.auth.transport.requests import Request

from connectors.google_oauth import credentials_from_auth

log = logging.getLogger(__name__)

# Fields requested from People API. Keep in lock-step with _to_contact_dict.
PERSON_FIELDS = (
    "names,emailAddresses,phoneNumbers,organizations,biographies,events,metadata"
)
# otherContacts.list only supports a small subset of fields
OTHER_PERSON_FIELDS = "names,emailAddresses,phoneNumbers,metadata"


class GooglePeopleClient:
    def __init__(self, auth: dict):
        creds = credentials_from_auth(auth)
        if not creds:
            raise ValueError("No valid People credentials")
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
        self._service = build("people", "v1", credentials=creds, cache_discovery=False)

    # ── Reads ────────────────────────────────────────────────────────────────
    def list_connections(
        self,
        sync_token: Optional[str] = None,
        page_size: int = 1000,
    ) -> Tuple[List[dict], Optional[str]]:
        """
        Pull the user's saved Google Contacts.

        - If sync_token is None: full sync, request a fresh token via requestSyncToken=true
        - If sync_token is provided: incremental — only changed contacts return
        - On 410 GONE: caller must wipe the stored token and full-resync

        Returns (contacts, new_sync_token).
        """
        people: List[dict] = []
        next_page_token: Optional[str] = None
        new_sync_token: Optional[str] = None

        while True:
            kwargs = dict(
                resourceName="people/me",
                personFields=PERSON_FIELDS,
                pageSize=page_size,
            )
            if sync_token:
                kwargs["syncToken"] = sync_token
            else:
                kwargs["requestSyncToken"] = True
            if next_page_token:
                kwargs["pageToken"] = next_page_token

            resp = self._service.people().connections().list(**kwargs).execute()
            people.extend(resp.get("connections", []))
            next_page_token = resp.get("nextPageToken")
            new_sync_token = resp.get("nextSyncToken") or new_sync_token
            if not next_page_token:
                break

        return people, new_sync_token

    def get_person(self, resource_name: str) -> dict:
        return self._service.people().get(
            resourceName=resource_name,
            personFields=PERSON_FIELDS,
        ).execute()

    def batch_get(self, resource_names: List[str]) -> List[dict]:
        """getPeople supports up to 200 resource names per call."""
        results: List[dict] = []
        for i in range(0, len(resource_names), 200):
            chunk = resource_names[i:i + 200]
            resp = self._service.people().getBatchGet(
                resourceNames=chunk,
                personFields=PERSON_FIELDS,
            ).execute()
            for r in resp.get("responses", []):
                person = r.get("person")
                if person:
                    results.append(person)
        return results

    def search_contacts(self, query: str, page_size: int = 25) -> List[dict]:
        """people.searchContacts — fuzzy match across the user's saved contacts."""
        resp = self._service.people().searchContacts(
            query=query,
            readMask=PERSON_FIELDS,
            pageSize=min(page_size, 30),  # API caps at 30
        ).execute()
        return [r["person"] for r in resp.get("results", []) if "person" in r]

    def list_other_contacts(self) -> List[dict]:
        """otherContacts.list — people you've emailed but never saved as a contact."""
        people: List[dict] = []
        next_page_token: Optional[str] = None
        while True:
            kwargs = dict(readMask=OTHER_PERSON_FIELDS, pageSize=1000)
            if next_page_token:
                kwargs["pageToken"] = next_page_token
            resp = self._service.otherContacts().list(**kwargs).execute()
            people.extend(resp.get("otherContacts", []))
            next_page_token = resp.get("nextPageToken")
            if not next_page_token:
                break
        return people

    def search_directory(self, query: str, page_size: int = 25) -> List[dict]:
        """Search Google Workspace directory (e.g. internal Growth Rocket team)."""
        resp = self._service.people().searchDirectoryPeople(
            query=query,
            readMask=PERSON_FIELDS,
            sources=["DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT"],
            pageSize=page_size,
        ).execute()
        return resp.get("people", [])

    # ── Writes ───────────────────────────────────────────────────────────────
    def create_contact(
        self,
        name: str,
        email: Optional[str] = None,
        phone: Optional[str] = None,
        organization: Optional[str] = None,
        job_title: Optional[str] = None,
        biography: Optional[str] = None,
    ) -> dict:
        body: dict = {"names": [{"unstructuredName": name}]}
        if email:
            body["emailAddresses"] = [{"value": email}]
        if phone:
            body["phoneNumbers"] = [{"value": phone}]
        if organization or job_title:
            org_entry: dict = {}
            if organization:
                org_entry["name"] = organization
            if job_title:
                org_entry["title"] = job_title
            body["organizations"] = [org_entry]
        if biography:
            body["biographies"] = [{"value": biography, "contentType": "TEXT_PLAIN"}]
        return self._service.people().createContact(body=body).execute()

    def update_contact(
        self,
        resource_name: str,
        etag: str,
        fields: dict,
        update_person_fields: str,
    ) -> dict:
        """
        Update a contact. `update_person_fields` is a comma-separated mask
        (e.g. "biographies,organizations") telling Google which fields to overwrite.
        `etag` is required for optimistic concurrency.
        """
        body = {"etag": etag, **fields}
        return self._service.people().updateContact(
            resourceName=resource_name,
            updatePersonFields=update_person_fields,
            body=body,
        ).execute()


# ── Person → Contact row mapping ─────────────────────────────────────────────
def _primary(items: List[dict], field: str) -> Optional[str]:
    """Pick the entry tagged metadata.primary=true, else the first."""
    if not items:
        return None
    for it in items:
        if it.get("metadata", {}).get("primary"):
            return it.get(field)
    return items[0].get(field)


def _first(items: List[dict], field: str) -> Optional[str]:
    return items[0].get(field) if items else None


def to_contact_dict(person: dict) -> dict:
    """
    Map a Google Person resource into the columns we store in our `contacts` table.
    Used by both people_sync.py and the approve-pending flow.
    """
    names = person.get("names", [])
    emails = person.get("emailAddresses", [])
    phones = person.get("phoneNumbers", [])
    orgs = person.get("organizations", [])
    bios = person.get("biographies", [])
    events = person.get("events", [])

    metadata = person.get("metadata", {})
    sources = metadata.get("sources", [])
    is_directory = any(s.get("type") == "DOMAIN_PROFILE" for s in sources)

    display_name = _first(names, "displayName") or _primary(names, "displayName")
    primary_email = _primary(emails, "value")
    primary_phone = _primary(phones, "value")

    organization = _first(orgs, "name")
    job_title = _first(orgs, "title")
    biography = _first(bios, "value")

    return {
        "google_resource_name": person.get("resourceName"),
        "etag": person.get("etag"),
        "display_name": display_name,
        "primary_email": primary_email,
        "primary_phone": primary_phone,
        "organization": organization,
        "job_title": job_title,
        "biography": biography,
        "emails": [{"value": e.get("value"), "type": e.get("type")} for e in emails],
        "phones": [{"value": p.get("value"), "type": p.get("type")} for p in phones],
        "sources": [{"type": s.get("type"), "id": s.get("id")} for s in sources],
        "events_json": [{"type": e.get("type"), "date": e.get("date")} for e in events],
        "is_directory": is_directory,
        "is_other_contact": False,  # callers override for otherContacts.list results
    }


__all__ = ["GooglePeopleClient", "to_contact_dict", "HttpError"]
