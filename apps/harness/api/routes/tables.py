"""
Doing something with a table TARS wrote.

Every structured answer already arrives as a markdown table, which renders as
text you can read and then have to retype somewhere useful. These routes are the
other half of the inline table component: the point where a number you were
shown becomes a number you can work with.

No new tool for the model to learn — the table it already writes is the input.
"""

import csv
import io
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import require_auth
from db.models import Artifact
from db.session import get_db

log = logging.getLogger(__name__)

router = APIRouter(prefix="/tables", tags=["tables"])

MAX_ROWS = 5000


class TablePayload(BaseModel):
    title: Optional[str] = None
    headers: List[str] = []
    rows: List[List[str]] = []


def _as_grid(body: TablePayload) -> List[List[str]]:
    if not body.rows:
        raise HTTPException(status_code=400, detail="Table has no rows")
    if len(body.rows) > MAX_ROWS:
        raise HTTPException(status_code=400, detail=f"Table exceeds {MAX_ROWS} rows")
    return ([body.headers] if body.headers else []) + body.rows


@router.post("/to-sheet")
async def table_to_sheet(
    body: TablePayload,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Create a Google Sheet from a table and hand back its URL."""
    from memory.second_brain import load_workspace_client

    client = await load_workspace_client(db)
    if client is None:
        raise HTTPException(
            status_code=409,
            detail="Google Workspace isn't connected — connect it in Connectors first.",
        )
    try:
        result = client.create_spreadsheet(body.title or "TARS export", _as_grid(body))
    except Exception as err:  # noqa: BLE001
        log.exception("table_to_sheet failed")
        raise HTTPException(status_code=502, detail=f"Sheets rejected it: {err}") from err
    return {"ok": True, "url": result["url"], "rows": result["rows"]}


@router.post("/to-artifact")
async def table_to_artifact(
    body: TablePayload,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Save a table to Artifacts as CSV.

    Stored as text rather than base64 so it stays searchable and TARS can read
    it back later — the same reasoning as browser downloads.
    """
    buf = io.StringIO()
    csv.writer(buf).writerows(_as_grid(body))
    content = buf.getvalue()

    name = (body.title or "table").strip().lower()
    name = "".join(c if c.isalnum() or c in " -_" else "" for c in name).strip()
    name = "-".join(name.split())[:60] or "table"

    artifact = Artifact(
        user_id=user_id,
        filename=f"{name}.csv",
        type="spreadsheet",
        source="chat",
        content=content,
        size_bytes=len(content.encode("utf-8")),
        tags=["table"],
    )
    db.add(artifact)
    await db.commit()
    await db.refresh(artifact)
    return {"ok": True, "artifact_id": artifact.id, "filename": artifact.filename}
