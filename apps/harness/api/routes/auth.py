from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from core.auth import verify_password, create_token, require_auth
from core.config import settings

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest):
    identifier = body.username.strip().lower()
    valid = {settings.tars_username.lower()}
    if settings.tars_email:
        valid.add(settings.tars_email.lower())

    if identifier not in valid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not settings.tars_password_hash or not verify_password(body.password, settings.tars_password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token = create_token(body.username)
    return LoginResponse(token=token)


@router.get("/token")
async def get_raw_token(user_id: str = Depends(require_auth)) -> dict:
    """Return a fresh JWT — used by frontend to auth WebSocket connections."""
    return {"token": create_token(user_id)}
