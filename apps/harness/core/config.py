from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    debug: bool = False
    allowed_origins: List[str] = ["http://localhost:3000"]

    database_url: str = "postgresql+asyncpg://tars:password@localhost:5432/tars"
    redis_url: str = "redis://localhost:6379"

    tars_username: str = "mike"
    tars_password_hash: str = ""
    jwt_secret: str = "change_me_in_production"
    session_secret: str = "change_me_in_production"
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 720  # 30 days

    anthropic_api_key: str = ""

    runpod_api_key: str = ""
    runpod_endpoint_32b: str = ""
    runpod_endpoint_8b: str = ""
    router_model: str = "Qwen/Qwen3-8B"
    workhorse_model: str = "Qwen/Qwen3-32B-AWQ"

    claude_code_path: str = "/usr/local/bin/claude"
    repos_base_path: str = "/home/tars/repos"

    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"


settings = Settings()
