from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from core.auth import verify_password, create_token
from core.config import settings

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest):
    if body.username != settings.tars_username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not settings.tars_password_hash or not verify_password(body.password, settings.tars_password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token = create_token(body.username)
    return LoginResponse(token=token)
