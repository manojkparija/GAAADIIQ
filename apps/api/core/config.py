import sys

from pydantic_settings import BaseSettings, SettingsConfigDict

_INSECURE_SECRET = "change-me-in-production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "GAADIIQ API"
    app_version: str = "0.1.0"
    debug: bool = False

    # "development" | "staging" | "production"
    environment: str = "development"

    # Database
    database_url: str = "postgresql+asyncpg://user:password@localhost:5432/gaadiiq"

    # Redis
    redis_url: str = "redis://localhost:6379"

    # Auth — RS256 asymmetric JWT
    # In production set JWT_PRIVATE_KEY / JWT_PUBLIC_KEY to PEM strings (newlines as \n).
    # In development a self-signed RSA keypair is generated on first startup if not set.
    jwt_private_key: str = ""
    jwt_public_key: str = ""
    algorithm: str = "RS256"
    access_token_expire_minutes: int = 60  # 1h
    refresh_token_expire_days: int = 30

    # CORS
    allowed_origins: list[str] = ["http://localhost:3000"]

    # Cloudflare R2 (S3-compatible)
    r2_endpoint_url: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket_name: str = "gaadiiq-media"
    r2_public_url: str = "https://media.gaadiiq.com"

    # OpenSearch — leave blank to use Postgres full-text search
    opensearch_url: str = ""

    # AI / Ollama
    ollama_base_url: str = "http://localhost:11434"
    valuation_model: str = "llama3"
    valuation_timeout_seconds: int = 30

    # Razorpay — leave blank to use dev auto-approve (only allowed when environment != production)
    RAZORPAY_KEY_ID: str = ""
    RAZORPAY_KEY_SECRET: str = ""

    # Frontend — used for reset-password link generation
    frontend_url: str = "http://localhost:3000"

    # SMTP — leave blank to skip emails in dev
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASS: str = ""
    SMTP_FROM: str = "noreply@gaadiiq.com"

    @property
    def async_database_url(self) -> str:
        """Return a postgresql+asyncpg:// URL regardless of what DATABASE_URL contains."""
        url = self.database_url
        if url.startswith("postgresql://"):
            url = "postgresql+asyncpg://" + url[len("postgresql://"):]
        elif url.startswith("postgres://"):
            url = "postgresql+asyncpg://" + url[len("postgres://"):]
        return url

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
        if not self.jwt_private_key or not self.jwt_public_key:
            errors.append("JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must be set in production (RS256 PEM strings)")
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
