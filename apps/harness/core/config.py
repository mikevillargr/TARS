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
    tars_email: str = ""
    tars_password_hash: str = ""
    jwt_secret: str = "change_me_in_production"
    session_secret: str = "change_me_in_production"
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 720

    # Use TARS_ANTHROPIC_API_KEY to avoid collision with Claude Desktop's env var
    anthropic_api_key: str = Field(default="", alias="tars_anthropic_api_key")

    # Z.ai — dual endpoints: Anthropic-compatible (GLM-4.x) and OpenAI-compatible (GLM-5.x)
    zai_api_key: str = ""
    zai_base_url: str = "https://api.z.ai/api/anthropic"          # GLM-4.x
    zai_openai_base_url: str = "https://api.z.ai/api/paas/v4/"    # GLM-5.x + vision

    # Per-tier provider selection: "anthropic" | "zai"
    tier1_provider: str = "anthropic"
    tier2_provider: str = "anthropic"
    tier3_provider: str = "anthropic"

    # Per-tier model overrides (blank = use sensible provider default)
    # Anthropic defaults: haiku / sonnet / sonnet  Z.ai defaults: glm-4.5-air / glm-4.6 / glm-4.7
    tier1_model_override: str = ""
    tier2_model_override: str = ""
    tier3_model_override: str = ""

    # Vision model — for analyzing images uploaded in chat
    # blank vision_provider = use tier3_provider; blank vision_model_override = use provider default
    # Anthropic default: claude-sonnet-4-6   Z.ai default: glm-4.5-air (multimodal)
    vision_provider: str = ""
    vision_model_override: str = ""

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

    strava_client_id: str = ""
    strava_client_secret: str = ""

    # Whisper voice transcription (faster-whisper, CPU)
    # Options: tiny, tiny.en, small, small.en, medium, medium.en, large-v3
    whisper_model: str = "small"

    # Kokoro TTS (kokoro-onnx embedded in harness process)
    # Model files at this path — downloaded once from GitHub releases
    # wget -P /opt/tars/models https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
    # wget -P /opt/tars/models https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
    kokoro_model_dir: str = "/opt/tars/models"
    kokoro_voice: str = "af_bella"   # see GET /api/tts/voices for all options

    # AlwaysSunny — solar + Tesla charging controller
    always_sunny_api_key: str = ""
    always_sunny_base_url: str = "http://76.13.191.149"

    # Tessie — full Tesla vehicle control API
    tessie_api_key: str = ""
    tessie_vin: str = ""

    github_token: str = ""   # PAT for agent git push + gh pr create

    claude_code_path: str = "/usr/local/bin/claude"
    repos_base_path: str = "/home/tars/repos"
    # Path to the TARS repo root — differs between local dev and VPS
    tars_repo_path: str = "/opt/tars"
    # Public URL of the TARS app — used in tool responses / system prompt
    tars_app_url: str = "http://localhost:3000"


settings = Settings()
