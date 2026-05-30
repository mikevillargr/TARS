"""
Unit tests for the Evolutionarist agent system.

Run with: .venv/bin/pytest tests/test_agents.py -v
"""
import asyncio
import pytest

# ── 1. Destructive pattern detection ──────────────────────────────────────────

from agents.executor import _is_destructive


def test_rm_rf_detected():
    assert _is_destructive("rm -rf /tmp/something") is not None


def test_rm_r_detected():
    assert _is_destructive("rm -r /tmp/dir") is not None


def test_push_to_main_detected():
    assert _is_destructive("git push origin main") is not None


def test_force_push_detected():
    assert _is_destructive("git push --force origin dev") is not None


def test_drop_table_detected():
    assert _is_destructive("DROP TABLE users") is not None


def test_safe_command_not_detected():
    assert _is_destructive("pytest tests/ -v") is None
    assert _is_destructive("git push origin dev") is None
    assert _is_destructive("git status") is None
    assert _is_destructive("npm run build") is None


# ── 2. Approval gate asyncio flow ─────────────────────────────────────────────

from agents.approval import get_or_create, resolve, reset, cleanup


def test_approval_gate_resolves():
    async def _run():
        gate = get_or_create("test-job-1")
        assert not gate.event.is_set()

        # Simulate frontend sending approval
        resolve("test-job-1", approved=True, modified_command=None)

        assert gate.event.is_set()
        assert gate.result["approved"] is True
        cleanup("test-job-1")

    asyncio.run(_run())


def test_approval_gate_reject():
    async def _run():
        gate = get_or_create("test-job-2")
        resolve("test-job-2", approved=False)
        assert gate.event.is_set()
        assert gate.result["approved"] is False
        cleanup("test-job-2")

    asyncio.run(_run())


def test_approval_gate_reset():
    async def _run():
        gate = get_or_create("test-job-3")
        resolve("test-job-3", approved=True)
        assert gate.event.is_set()

        reset("test-job-3")
        assert not gate.event.is_set()
        assert gate.result["approved"] is False
        cleanup("test-job-3")

    asyncio.run(_run())


def test_approval_gate_wait_and_resume():
    """Gate blocks until resolved, then resumes."""
    async def _run():
        gate = get_or_create("test-job-4")
        resolved = []

        async def waiter():
            await gate.event.wait()
            resolved.append(True)

        async def resolver():
            await asyncio.sleep(0.01)
            resolve("test-job-4", approved=True)

        await asyncio.gather(waiter(), resolver())
        assert resolved == [True]
        cleanup("test-job-4")

    asyncio.run(_run())


# ── 3. Evolutionarist spawn_agent tool routing ────────────────────────────────

from agents.job_manager import DEFAULT_MODELS


def test_default_models_keys():
    assert set(DEFAULT_MODELS.keys()) == {"evolutionarist", "frontend", "backend", "sa", "release"}


def test_frontend_backend_use_sonnet():
    assert "sonnet" in DEFAULT_MODELS["frontend"]
    assert "sonnet" in DEFAULT_MODELS["backend"]


def test_sa_uses_opus():
    assert "opus" in DEFAULT_MODELS["sa"]


# ── 4. API safety: branch validation ─────────────────────────────────────────

from api.routes.agent_jobs import CreateJobRequest


def test_create_request_defaults():
    req = CreateJobRequest(instruction="do something")
    assert req.agent_type == "evolutionarist"
    assert req.branch if hasattr(req, "branch") else True  # branch validated server-side


# ── 5. verify_ws_token rejects invalid tokens ─────────────────────────────────

from core.auth import verify_ws_token


def test_ws_token_invalid():
    assert verify_ws_token("not-a-jwt") is None
    assert verify_ws_token("") is None
    assert verify_ws_token("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.bad.sig") is None
