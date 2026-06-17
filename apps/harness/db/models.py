import uuid
from datetime import datetime, timezone
from typing import Optional, List
from sqlalchemy import String, Text, Integer, Float, Boolean, DateTime, ForeignKey, JSON, Enum, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector

from db.base import Base


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String, nullable=False)
    timezone: Mapped[str] = mapped_column(String, default="Asia/Manila")
    preferences: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class Memory(Base):
    __tablename__ = "memories"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[Optional[List[float]]] = mapped_column(Vector(768), nullable=True)
    domain: Mapped[str] = mapped_column(String, default="work")
    source: Mapped[str] = mapped_column(String, default="conversation")
    importance: Mapped[int] = mapped_column(Integer, default=3)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    title: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    context_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    messages: Mapped[List["Message"]] = relationship("Message", back_populates="conversation")


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    conversation_id: Mapped[str] = mapped_column(String, ForeignKey("conversations.id"), nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    model_used: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    tokens_used: Mapped[int] = mapped_column(Integer, default=0)
    tool_calls: Mapped[list] = mapped_column(JSON, default=list)
    tool_results: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    conversation: Mapped["Conversation"] = relationship("Conversation", back_populates="messages")


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, default="inbox")
    priority: Mapped[str] = mapped_column(String, default="normal")
    due_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    source: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    source_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    assigned_to: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    connector_ref: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    linked_artifacts: Mapped[list] = mapped_column(JSON, default=list)   # list of artifact IDs
    linked_knowledge: Mapped[list] = mapped_column(JSON, default=list)   # list of knowledge item IDs
    checklist: Mapped[list] = mapped_column(JSON, default=list)          # [{id, text, done}]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class TaskColumn(Base):
    __tablename__ = "task_columns"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    color: Mapped[str] = mapped_column(String, nullable=False, default="var(--c-ink-muted)")
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class Meeting(Base):
    __tablename__ = "meetings"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    transcript: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    attendees: Mapped[list] = mapped_column(JSON, default=list)
    connector_ref: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="processing")
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class MeetingActionItem(Base):
    __tablename__ = "meeting_action_items"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    meeting_id: Mapped[str] = mapped_column(String, ForeignKey("meetings.id"), nullable=False)
    task_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    owner: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class CronJob(Base):
    __tablename__ = "cron_jobs"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    # "connector" jobs use schedule (interval string) + connector_ids
    # "prompt" jobs use schedule_config (dict) + prompt_text
    type: Mapped[str] = mapped_column(String, default="connector")
    schedule: Mapped[str] = mapped_column(String, nullable=False, default="")
    connector_ids: Mapped[list] = mapped_column(JSON, default=list)
    # prompt cron fields
    prompt_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    schedule_config: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    timezone: Mapped[str] = mapped_column(String, default="Asia/Manila")
    last_output: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    output_conversation_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # shared
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_run_status: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    next_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class AgentJob(Base):
    __tablename__ = "agent_jobs"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    # agent_type: evolutionarist | frontend | backend | sa | release
    agent_type: Mapped[str] = mapped_column(String, default="evolutionarist")
    # kept for backwards compat with old stub rows
    type: Mapped[str] = mapped_column(String, nullable=False, default="agent")
    instruction: Mapped[str] = mapped_column(Text, nullable=False)
    repo_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    branch: Mapped[str] = mapped_column(String, default="dev")
    # status: pending | running | awaiting_approval | completed | failed | cancelled
    status: Mapped[str] = mapped_column(String, default="pending")
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=True)
    approval_prompt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    output: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    pr_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # model config per agent type, e.g. {"frontend": "claude-sonnet-4-6", "sa": "claude-opus-4-5"}
    model_config_json: Mapped[dict] = mapped_column(JSON, default=dict)
    # link to chat conversation for live-stream view
    conversation_id: Mapped[Optional[str]] = mapped_column(
        String, ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True
    )
    # sub-agent jobs point to their parent orchestrator job
    parent_job_id: Mapped[Optional[str]] = mapped_column(
        String, ForeignKey("agent_jobs.id", ondelete="SET NULL"), nullable=True
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class Connector(Base):
    __tablename__ = "connectors"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, default="disconnected")
    auth: Mapped[dict] = mapped_column(JSON, default=dict)
    capabilities: Mapped[list] = mapped_column(JSON, default=list)
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class WebhookEvent(Base):
    __tablename__ = "webhook_events"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    connector_id: Mapped[str] = mapped_column(String, ForeignKey("connectors.id"), nullable=False)
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    processed: Mapped[bool] = mapped_column(Boolean, default=False)
    processed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class KnowledgeItem(Base):
    __tablename__ = "knowledge_items"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    raw_content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    clean_content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    personal_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    domain: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    project_ref: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    topics: Mapped[list] = mapped_column(JSON, default=list)
    embedding: Mapped[Optional[List[float]]] = mapped_column(Vector(768), nullable=True)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_title: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    source_author: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    starred: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    properties: Mapped[dict] = mapped_column(JSON, default=dict)
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    last_accessed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    access_count: Mapped[int] = mapped_column(Integer, default=0)
    chunks: Mapped[List["DocumentChunk"]] = relationship("DocumentChunk", back_populates="item")


class DocumentChunk(Base):
    __tablename__ = "document_chunks"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    knowledge_item_id: Mapped[str] = mapped_column(String, ForeignKey("knowledge_items.id", ondelete="CASCADE"), nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[Optional[List[float]]] = mapped_column(Vector(768), nullable=True)
    page_or_slide: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    item: Mapped["KnowledgeItem"] = relationship("KnowledgeItem", back_populates="chunks")


class KnowledgeCollection(Base):
    __tablename__ = "knowledge_collections"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    item_ids: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class Artifact(Base):
    __tablename__ = "artifacts"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    source: Mapped[str] = mapped_column(String, nullable=False)
    source_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    embedding: Mapped[Optional[List[float]]] = mapped_column(Vector(768), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    parent_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("artifacts.id"), nullable=True)
    project_ref: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


# ── Universal Links ──────────────────────────────────────────────────────────

class Link(Base):
    """Polymorphic cross-module link between any two TARS entities."""
    __tablename__ = "links"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    # source_type / target_type: "task" | "meeting" | "knowledge_item" | "artifact" | "contact"
    source_type: Mapped[str] = mapped_column(String, nullable=False)
    source_id: Mapped[str] = mapped_column(String, nullable=False)
    target_type: Mapped[str] = mapped_column(String, nullable=False)
    target_id: Mapped[str] = mapped_column(String, nullable=False)
    # relationship: "mentions" | "related_to" | "created_from" | "blocks" | "references"
    relationship: Mapped[str] = mapped_column(String, nullable=False, default="mentions")
    context: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    __table_args__ = (
        UniqueConstraint(
            "user_id", "source_type", "source_id", "target_type", "target_id", "relationship",
            name="uq_links",
        ),
    )


# ── Google People API ────────────────────────────────────────────────────────
class Contact(Base):
    """Local mirror of a Google Contact (people/* resource)."""
    __tablename__ = "contacts"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False, index=True)
    google_resource_name: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    etag: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    display_name: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)
    primary_email: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)
    primary_phone: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    organization: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    job_title: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    biography: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tars_context: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    emails: Mapped[list] = mapped_column(JSON, default=list)
    phones: Mapped[list] = mapped_column(JSON, default=list)
    sources: Mapped[list] = mapped_column(JSON, default=list)
    events_json: Mapped[list] = mapped_column(JSON, default=list)
    is_directory: Mapped[bool] = mapped_column(Boolean, default=False)
    is_other_contact: Mapped[bool] = mapped_column(Boolean, default=False)
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


class PendingContact(Base):
    """Person detected from meeting / email / chat awaiting user approval."""
    __tablename__ = "pending_contacts"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    detected_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    detected_email: Mapped[str] = mapped_column(String, nullable=False, index=True)
    detected_phone: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    source: Mapped[str] = mapped_column(String, nullable=False)        # "meeting" | "email" | "chat"
    source_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    extracted_context: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, default="pending")     # pending | approved | rejected | existing
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class ContactSyncState(Base):
    """Per-user sync token from Google People API for incremental sync."""
    __tablename__ = "contact_sync_state"
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), primary_key=True)
    sync_token: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    last_sync_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


# ── User Domains ─────────────────────────────────────────────────────────────

class UserDomain(Base):
    """User-managed taxonomy shared by Second Brain and Mnemon."""
    __tablename__ = "user_domains"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    color: Mapped[str] = mapped_column(String, nullable=False, default="#6B7280")
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


# ── Places ───────────────────────────────────────────────────────────────────
class Place(Base):
    """Personal places — saved locations with coordinates and metadata."""
    __tablename__ = "places"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False, index=True)
    address: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    category: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    osm_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    osm_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # "node" | "way" | "relation"
    google_place_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    source: Mapped[str] = mapped_column(String, default="osm")              # "osm" | "google" | "manual"
    visited_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    is_saved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)
