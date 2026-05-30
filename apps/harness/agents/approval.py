# Approval gate for agent jobs — version-controlled by Evolutionarist
"""
Per-job approval gate. Backend pauses the executor stream and waits for
the frontend to respond via WebSocket.

State is in-memory — intentionally ephemeral. If the harness restarts while
a job is awaiting approval the gate is lost and the job must be retried.
That's acceptable for Phase 1.
"""
import asyncio
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ApprovalGate:
    event: asyncio.Event = field(default_factory=asyncio.Event)
    result: dict = field(default_factory=lambda: {"approved": False, "modified_command": None})


# job_id -> ApprovalGate
_gates: dict[str, ApprovalGate] = {}


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
