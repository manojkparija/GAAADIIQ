from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_name: str = "GAADIIQ API"
    app_version: str = "0.1.0"
    debug: bool = False

    # Database
    database_url: str = "postgresql+asyncpg://user:password@localhost:5432/gaadiiq"

    # Redis
    redis_url: str = "redis://localhost:6379"

    # Auth
    secret_key: str = "change-me-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24  # 24h

    # CORS
    allowed_origins: list[str] = ["http://localhost:3000"]

    # Cloudflare R2 (S3-compatible)
    r2_endpoint_url: str = "https://<account-id>.r2.cloudflarestorage.com"
    r2_access_key_id: str = "your-r2-access-key"
    r2_secret_access_key: str = "your-r2-secret-key"
    r2_bucket_name: str = "gaadiiq-media"
    r2_public_url: str = "https://media.gaadiiq.com"

    # AI / Ollama (self-hosted on Oracle Cloud)
    ollama_base_url: str = "http://localhost:11434"
    valuation_model: str = "llama3"
    valuation_timeout_seconds: int = 30

    # SMTP (optional — leave blank to skip emails in dev)
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASS: str = ""
    SMTP_FROM: str = "noreply@gaadiiq.com"


settings = Settings()
