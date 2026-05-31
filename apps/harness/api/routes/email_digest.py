from fastapi import APIRouter, Depends
from core.auth import require_auth

router = APIRouter()


@router.get("")
async def list_email_digest(_: str = Depends(require_auth)):
    return {"items": [], "stub": True}
