import base64
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from core.auth import require_auth
from core.artifact_store import store_upload_as_artifact
from core.blob_store import resolve_artifact_bytes
from core import blob_store
from db.session import get_db
from db.models import Artifact

router = APIRouter()

# MIME type map for serving binary artifacts (download + view endpoints)
_BINARY_MIME = {
    # Documents
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pdf":  "application/pdf",
    ".doc":  "application/msword",
    ".rtf":  "application/rtf",
    # Images
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png":  "image/png",
    ".gif":  "image/gif",
    ".webp": "image/webp",
    ".svg":  "image/svg+xml",
    # Audio
    ".mp3":  "audio/mpeg",
    ".wav":  "audio/wav",
    ".m4a":  "audio/mp4",
    ".aac":  "audio/aac",
    ".ogg":  "audio/ogg",
    ".flac": "audio/flac",
    # Video
    ".mp4":  "video/mp4",
    ".mov":  "video/quicktime",
    ".avi":  "video/x-msvideo",
    ".mkv":  "video/x-matroska",
    ".webm": "video/webm",
    ".m4v":  "video/mp4",
    # Archives
    ".zip":  "application/zip",
    ".tar":  "application/x-tar",
    ".gz":   "application/gzip",
    ".7z":   "application/x-7z-compressed",
    ".rar":  "application/vnd.rar",
}


# ─── Response models ──────────────────────────────────────────────────────────

class ArtifactVersionOut(BaseModel):
    version: int
    created_at: datetime
    size_bytes: int

    class Config:
        from_attributes = True


class ArtifactOut(BaseModel):
    id: str
    filename: str
    type: str
    source: str
    source_id: Optional[str]
    project_ref: Optional[str]
    tags: list
    size_bytes: int
    version: int
    parent_id: Optional[str]
    created_at: datetime
    # True when the artifact has a binary payload on disk (or a legacy base64
    # payload still awaiting backfill) — tells the client to render via
    # /view or /preview instead of expecting displayable content.
    has_file: bool = False

    class Config:
        from_attributes = True


class ArtifactDetailOut(ArtifactOut):
    content: Optional[str] = None


class CreateArtifactRequest(BaseModel):
    filename: str
    type: str                          # document | code | report | spreadsheet | transcript
    source: str                        # chat | agent_job | cron | meeting | upload
    source_id: Optional[str] = None
    content: str
    project_ref: Optional[str] = None
    tags: List[str] = []
    parent_id: Optional[str] = None   # set to re-version an existing artifact


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _classify_type(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext in {"py", "ts", "tsx", "js", "jsx", "go", "rs", "java", "rb", "sh",
               "diff", "patch", "json", "yaml", "yml", "xml", "toml", "sql",
               "css", "scss", "graphql", "c", "cpp", "h", "cs", "swift", "kt"}:
        return "code"
    if ext in {"csv", "xlsx", "xls"}:
        return "spreadsheet"
    if ext in {"txt", "vtt", "srt", "mp3", "wav", "m4a", "aac", "ogg", "flac"}:
        return "transcript"
    if ext in {"jpg", "jpeg", "png", "gif", "webp", "svg"}:
        return "image"
    return "document"


# ─── Routes ───────────────────────────────────────────────────────────────────

_HAS_FILE_SQL = (Artifact.storage_path.isnot(None)) | (Artifact.content.like("base64:%"))


def _artifact_list_query():
    """SELECT artifacts without loading the (possibly huge) content column.

    has_file is computed in SQL so the client can pick a renderer without us
    shipping multi-MB text — or, for legacy rows, base64 — payloads.
    """
    return (
        select(Artifact, _HAS_FILE_SQL.label("has_file"))
        .options(defer(Artifact.content))
    )


def _to_out(rows) -> List[ArtifactOut]:
    out: List[ArtifactOut] = []
    for art, has_file in rows:
        item = ArtifactOut.model_validate(art)
        item.has_file = bool(has_file)
        out.append(item)
    return out


@router.get("", response_model=List[ArtifactOut])
async def list_artifacts(
    type: Optional[str] = None,
    source: Optional[str] = None,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    q = _artifact_list_query().where(Artifact.user_id == user_id)
    if type:
        q = q.where(Artifact.type == type)
    if source:
        q = q.where(Artifact.source == source)
    q = q.order_by(Artifact.created_at.desc()).limit(200)
    result = await db.execute(q)
    return _to_out(result.all())


@router.get("/{artifact_id}", response_model=ArtifactDetailOut)
async def get_artifact(
    artifact_id: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Artifact).where(Artifact.id == artifact_id, Artifact.user_id == user_id)
    )
    artifact = result.scalar_one_or_none()
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")

    has_file = bool(artifact.storage_path)

    # Legacy rows still carry the binary payload as "base64:" text. Never ship
    # it here — images and PDFs render from /view, documents from /preview — so
    # sending it only meant waiting on a multi-MB download before anything
    # appeared. Detach FIRST: mutating a live ORM object marks it dirty and a
    # flush would persist the truncation, destroying the stored file.
    if artifact.content and artifact.content.startswith("base64:"):
        has_file = True
        db.expunge(artifact)
        artifact.content = None

    resp = ArtifactDetailOut.model_validate(artifact)
    resp.has_file = has_file
    return resp


@router.get("/{artifact_id}/versions", response_model=List[ArtifactOut])
async def list_artifact_versions(
    artifact_id: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Return all versions of an artifact (the one with this id + any that share parent_id)."""
    # Find the root — could be this artifact or its parent
    result = await db.execute(
        select(Artifact).where(Artifact.id == artifact_id, Artifact.user_id == user_id)
    )
    artifact = result.scalar_one_or_none()
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")

    root_id = artifact.parent_id or artifact_id

    versions_result = await db.execute(
        _artifact_list_query()
        .where(
            Artifact.user_id == user_id,
            (Artifact.id == root_id) | (Artifact.parent_id == root_id),
        )
        .order_by(Artifact.version.desc())
    )
    return _to_out(versions_result.all())


@router.post("", response_model=ArtifactDetailOut, status_code=201)
async def create_artifact(
    body: CreateArtifactRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    artifact_type = body.type or _classify_type(body.filename)

    # Clients that POST binary as a "base64:" string (e.g. the Rokid glasses
    # bridge) get moved to the blob store here — content keeps text only.
    content: Optional[str] = body.content
    storage_path: Optional[str] = None
    size_bytes = len(body.content.encode("utf-8"))
    if content.startswith("base64:"):
        raw = base64.b64decode(content[7:])
        ext = body.filename.rsplit(".", 1)[-1].lower() if "." in body.filename else "bin"
        storage_path = blob_store.store(raw, ext, user_id)
        content = None
        size_bytes = len(raw)

    # If this is a new version of an existing artifact, bump version number
    version = 1
    if body.parent_id:
        result = await db.execute(
            select(Artifact)
            .where(
                Artifact.user_id == user_id,
                (Artifact.id == body.parent_id) | (Artifact.parent_id == body.parent_id),
            )
            .order_by(Artifact.version.desc())
            .limit(1)
        )
        latest = result.scalar_one_or_none()
        if latest:
            version = latest.version + 1

    artifact = Artifact(
        user_id=user_id,
        filename=body.filename,
        type=artifact_type,
        source=body.source,
        source_id=body.source_id,
        content=content,
        storage_path=storage_path,
        version=version,
        parent_id=body.parent_id,
        project_ref=body.project_ref,
        tags=body.tags,
        size_bytes=size_bytes,
    )
    db.add(artifact)
    await db.commit()
    await db.refresh(artifact)
    resp = ArtifactDetailOut.model_validate(artifact)
    resp.has_file = bool(storage_path)
    return resp


@router.delete("/{artifact_id}", status_code=204)
async def delete_artifact(
    artifact_id: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Artifact).where(Artifact.id == artifact_id, Artifact.user_id == user_id)
    )
    artifact = result.scalar_one_or_none()
    if not artifact:
        raise HTTPException(status_code=404, detail="Artifact not found")
    if artifact.storage_path:
        blob_store.delete(artifact.storage_path)
    await db.execute(delete(Artifact).where(Artifact.id == artifact_id))
    await db.commit()


@router.get("/{artifact_id}/download")
async def download_artifact(
    artifact_id: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """
    Serve an artifact as a downloadable binary file.
    Text artifacts are served as text/plain; binary artifacts are read from the
    blob store (or decoded from legacy base64 content) and served with the
    correct MIME type.
    """
    result = await db.execute(
        select(Artifact).where(Artifact.id == artifact_id, Artifact.user_id == user_id)
    )
    art = result.scalar_one_or_none()
    if not art:
        raise HTTPException(status_code=404, detail="Artifact not found")

    filename = art.filename or "download"
    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""

    raw = resolve_artifact_bytes(art)
    if raw is not None:
        mime = _BINARY_MIME.get(ext, "application/octet-stream")
        return Response(
            content=raw,
            media_type=mime,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    # Text artifact — serve as UTF-8
    content = art.content or ""
    return Response(
        content=content.encode("utf-8"),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{artifact_id}/view")
async def view_artifact(
    artifact_id: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """
    Serve artifact inline (for iframe/preview embedding).
    Same as /download but uses Content-Disposition: inline so the browser
    renders it in-place rather than triggering a save dialog.
    """
    result = await db.execute(
        select(Artifact).where(Artifact.id == artifact_id, Artifact.user_id == user_id)
    )
    art = result.scalar_one_or_none()
    if not art:
        raise HTTPException(status_code=404, detail="Artifact not found")

    filename = art.filename or "preview"
    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""

    raw = resolve_artifact_bytes(art)
    if raw is not None:
        mime = _BINARY_MIME.get(ext, "application/octet-stream")
        return Response(
            content=raw,
            media_type=mime,
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )

    content = art.content or ""
    return Response(
        content=content.encode("utf-8"),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.get("/{artifact_id}/preview")
async def preview_artifact(
    artifact_id: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """
    Extract human-readable preview text from binary artifacts.
    Returns JSON { text: str, type: "docx"|"pptx"|"text" }.
    PDF files should use /view (rendered by the browser via iframe).
    """
    result = await db.execute(
        select(Artifact).where(Artifact.id == artifact_id, Artifact.user_id == user_id)
    )
    art = result.scalar_one_or_none()
    if not art:
        raise HTTPException(status_code=404, detail="Artifact not found")

    content = art.content or ""
    filename = (art.filename or "").lower()

    raw = resolve_artifact_bytes(art)
    if raw is None:
        return {"text": content[:8000], "type": "text"}

    _img_exts = (".jpg", ".jpeg", ".png", ".gif", ".webp")
    if any(filename.endswith(e) for e in _img_exts):
        # Images are served directly via /view — return a signal so the frontend renders <img>
        return {"text": "", "type": "image"}

    if filename.endswith(".pdf"):
        try:
            from ingest.parsers import pdf as _pdf_parser
            text = _pdf_parser.extract(raw)
            return {"text": text[:8000], "type": "text"}
        except Exception as exc:
            return {"text": f"(preview extraction failed: {exc})", "type": "text"}

    if filename.endswith(".docx"):
        try:
            import docx as _docx
            from io import BytesIO as _BIO
            doc = _docx.Document(_BIO(raw))
            texts: list[str] = []
            for para in doc.paragraphs:
                if para.text.strip():
                    texts.append(para.text)
            for table in doc.tables:
                for row in table.rows:
                    row_cells = [c.text.strip() for c in row.cells if c.text.strip()]
                    if row_cells:
                        texts.append(" | ".join(row_cells))
            return {"text": "\n\n".join(texts[:400]), "type": "docx"}
        except Exception as exc:
            return {"text": f"(preview extraction failed: {exc})", "type": "text"}

    if filename.endswith(".pptx"):
        try:
            from pptx import Presentation as _Prs
            from io import BytesIO as _BIO
            prs = _Prs(_BIO(raw))
            slides_text = []
            for i, slide in enumerate(prs.slides):
                texts = [
                    shp.text_frame.text.strip()
                    for shp in slide.shapes
                    if hasattr(shp, "text_frame") and shp.text_frame.text.strip()
                ]
                if texts:
                    slides_text.append(f"## Slide {i + 1}\n" + "\n".join(texts))
            return {"text": "\n\n".join(slides_text), "type": "pptx"}
        except Exception as exc:
            return {"text": f"(preview extraction failed: {exc})", "type": "text"}

    if filename.endswith(".xlsx") or filename.endswith(".xls"):
        try:
            from ingest.parsers import xlsx as _xlsx_parser
            text = _xlsx_parser.extract(raw, filename=filename)
            return {"text": text[:16000], "type": "text"}
        except Exception as exc:
            return {"text": f"(preview extraction failed: {exc})", "type": "text"}

    # Unknown binary (shouldn't normally reach here for DOCX/PPTX/PDF)
    return {"text": "", "type": "binary"}


@router.post("/ingest", response_model=ArtifactDetailOut, status_code=201)
async def ingest_artifact(
    file: UploadFile = File(...),
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload any file and have it parsed into an Artifact.
    Binary office/PDF/image/media payloads go to the disk blob store so the
    original can be downloaded and previewed; text/code files are stored as
    extracted text.
    """
    artifact = await store_upload_as_artifact(
        user_id=user_id,
        data=await file.read(),
        filename=file.filename or "upload",
        source="upload",
        db=db,
        mime_type=file.content_type or "",
    )
    resp = ArtifactDetailOut.model_validate(artifact)
    resp.has_file = bool(artifact.storage_path)
    return resp
