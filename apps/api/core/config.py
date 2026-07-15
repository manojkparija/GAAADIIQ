import sys

from pydantic_settings import BaseSettings, SettingsConfigDict

_INSECURE_SECRET = "change-me-in-production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_name: str = "GAADIIQ API"
    app_version: str = "0.1.0"
    debug: bool = False

    # "development" | "staging" | "production"
    environment: str = "development"

    # Database
    database_url: str = "postgresql+asyncpg://user:password@localhost:5432/gaadiiq"

    # Redis
    redis_url: str = "redis://localhost:6379"

    # Auth
    secret_key: str = _INSECURE_SECRET
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60  # 1h (was 24h)
    refresh_token_expire_days: int = 30

    # CORS
    allowed_origins: list[str] = ["http://localhost:3000"]

    # Cloudflare R2 (S3-compatible)
    r2_endpoint_url: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket_name: str = "gaadiiq-media"
    r2_public_url: str = "https://media.gaadiiq.com"

    # AI / Ollama
    ollama_base_url: str = "http://localhost:11434"
    valuation_model: str = "llama3"
    valuation_timeout_seconds: int = 30

    # Razorpay — leave blank to use dev auto-approve (only allowed when environment != production)
    RAZORPAY_KEY_ID: str = ""
    RAZORPAY_KEY_SECRET: str = ""

    # SMTP — leave blank to skip emails in dev
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASS: str = ""
    SMTP_FROM: str = "noreply@gaadiiq.com"

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def payments_enabled(self) -> bool:
        """Payments are only real when Razorpay keys are present."""
        return bool(self.RAZORPAY_KEY_ID and self.RAZORPAY_KEY_SECRET)

    def validate_production_config(self) -> None:
        """Call at startup — aborts if required prod secrets are missing/default."""
        if not self.is_production:
            return
        errors: list[str] = []
        if self.secret_key == _INSECURE_SECRET:
            errors.append("SECRET_KEY must be set to a strong random value in production")
        if not self.RAZORPAY_KEY_ID or not self.RAZORPAY_KEY_SECRET:
            errors.append("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in production")
        if not self.SMTP_HOST:
            errors.append("SMTP_HOST must be configured in production")
        if errors:
            print("FATAL: production configuration errors:", file=sys.stderr)
            for e in errors:
                print(f"  - {e}", file=sys.stderr)
            sys.exit(1)


settings = Settings()
