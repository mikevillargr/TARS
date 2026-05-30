"""
Per-job gates that pause the executor stream and wait for frontend response
via WebSocket. Two gate types:

  ApprovalGate — destructive command approval (approve/reject + optional command edit)
  QuestionGate — agent asks the user a question mid-job and waits for a text answer

State is in-memory — intentionally ephemeral. If the harness restarts while
a job is gated the gate is lost and the job must be retried. Acceptable for Phase 1.
"""
import asyncio
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ApprovalGate:
    event: asyncio.Event = field(default_factory=asyncio.Event)
    result: dict = field(default_factory=lambda: {"approved": False, "modified_command": None})


@dataclass
class QuestionGate:
    event: asyncio.Event = field(default_factory=asyncio.Event)
    answer: str = ""


# job_id -> ApprovalGate
_gates: dict[str, ApprovalGate] = {}

# job_id -> QuestionGate
_question_gates: dict[str, QuestionGate] = {}


# ── Approval gate ──────────────────────────────────────────────────────────────

def get_or_create(job_id: str) -> ApprovalGate:
    if job_id not in _gates:
        _gates[job_id] = ApprovalGate()
    return _gates[job_id]


def resolve(job_id: str, approved: bool, modified_command: Optional[str] = None) -> None:
    gate = _gates.get(job_id)
    if gate:
        gate.result = {"approved": approved, "modified_command": modified_command}
        gate.event.set()


def reset(job_id: str) -> None:
    """Reset the gate so it can be used for the next approval request in the same job."""
    gate = _gates.get(job_id)
    if gate:
        gate.event.clear()
        gate.result = {"approved": False, "modified_command": None}


def cleanup(job_id: str) -> None:
    _gates.pop(job_id, None)


# ── Question gate ──────────────────────────────────────────────────────────────

def get_or_create_question(job_id: str) -> QuestionGate:
    if job_id not in _question_gates:
        _question_gates[job_id] = QuestionGate()
    return _question_gates[job_id]


def resolve_question(job_id: str, answer: str) -> None:
    gate = _question_gates.get(job_id)
    if gate:
        gate.answer = answer
        gate.event.set()


def reset_question(job_id: str) -> None:
    """Reset so the gate can be reused for the next question in the same job."""
    gate = _question_gates.get(job_id)
    if gate:
        gate.event.clear()
        gate.answer = ""


def cleanup_question(job_id: str) -> None:
    _question_gates.pop(job_id, None)
