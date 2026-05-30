from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    debug: bool = False
    allowed_origins: List[str] = ["http://localhost:3000"]

    database_url: str = "postgresql+asyncpg://tars:password@localhost:5432/tars"
    redis_url: str = "redis://localhost:6379"

    tars_username: str = "mike"
    tars_password_hash: str = ""
    jwt_secret: str = "change_me_in_production"
    session_secret: str = "change_me_in_production"
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 720

    # Use TARS_ANTHROPIC_API_KEY to avoid collision with Claude Desktop's env var
    anthropic_api_key: str = Field(default="", alias="tars_anthropic_api_key")

    runpod_api_key: str = ""
    runpod_endpoint_32b: str = ""
    workhorse_model: str = ""   # RunPod model name — set in .env (e.g. meta/llama-3.1-70b-instruct)

    # Tier 1 + classifier model — fast, cheap, always available
    tier1_model: str = "claude-haiku-4-5-20251001"

    # Legacy — Ollama retired; kept so old .env files don't break on startup
    ollama_url: str = ""
    classifier_model: str = ""

    # Web search
    tavily_api_key: str = ""

    # Connectors
    fireflies_api_key: str = ""
    gmail_client_id: str = ""
    gmail_client_secret: str = ""
    gcal_client_id: str = ""
    gcal_client_secret: str = ""
    google_people_client_id: str = ""
    google_people_client_secret: str = ""

    # Whisper voice transcription (faster-whisper, CPU)
    # Options: tiny, tiny.en, small, small.en, medium, medium.en, large-v3
    whisper_model: str = "small"

    claude_code_path: str = "/usr/local/bin/claude"
    repos_base_path: str = "/home/tars/repos"
    # Path to the TARS repo root — differs between local dev and VPS
    tars_repo_path: str = "/opt/tars"
    # Public URL of the TARS app — used in tool responses / system prompt
    tars_app_url: str = "http://localhost:3000"


settings = Settings()
