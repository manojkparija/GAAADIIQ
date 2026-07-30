import os
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

    # Database — Railway provides postgresql:// but asyncpg requires postgresql+asyncpg://
    database_url: str = "postgresql+asyncpg://user:password@localhost:5432/gaadiiq"

    @property
    def async_database_url(self) -> str:
        url = self.database_url
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+asyncpg://", 1)
        return url

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

    # CORS — includes Capacitor Android scheme, Angular dev server, and production domains
    allowed_origins: list[str] = [
        "http://localhost:3000",
        "http://localhost:4200",
        "https://localhost:4200",
        "capacitor://localhost",
        "ionic://localhost",
        "https://gaadiiq.com",
        "https://www.gaadiiq.com",
        "https://app.gaadiiq.com",
    ]

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

    # Ollama models
    ollama_model: str = "llama3"
    ollama_diagnosis_model: str = "llama3"
    ollama_vision_model: str = "llava"
    ollama_url: str = "http://localhost:11434"  # alias used by sentiment service

    # Server-side speech-to-text (BR-API-01) — fallback for WebViews and
    # browsers without the Web Speech API. Provider is selected by
    # STT_PROVIDER; "none" disables the endpoint (503).
    stt_provider: str = "none"          # none | whisper | openai | google | azure
    stt_api_key: str = ""
    stt_api_url: str = ""               # self-hosted Whisper / custom gateway
    stt_model: str = "whisper-1"
    stt_timeout_seconds: int = 45
    stt_max_audio_seconds: int = 60     # BR-IR-04 duration cap
    stt_max_bytes: int = 25 * 1024 * 1024

    # Supabase JWT secret (HS256). The UI authenticates against Supabase, whose
    # tokens this backend cannot otherwise verify — its own tokens are RS256
    # with a different key. Without this, a Supabase-authenticated caller is
    # indistinguishable from an anonymous one.
    supabase_jwt_secret: str = ""
    # Project URL, e.g. https://abcdefgh.supabase.co — used to fetch the JWKS
    # when the project signs tokens with asymmetric keys rather than the
    # legacy shared secret.
    supabase_url: str = ""

    # Emails always treated as admin, regardless of which user store holds the
    # role. Checked only against a *verified* token, never a client-sent value.
    admin_emails: str = ""

    @property
    def admin_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.admin_emails.split(",") if e.strip()}

    # Gemini — higher-quality diagnosis for paid users and admins. Ollama is
    # the free tier. Leave the key blank and everyone falls back to Ollama.
    gemini_api_key: str = ""
    # gemini-2.0-flash was shut down on 2026-06-01, so the previous default
    # named a model the API no longer serves. Flash-Lite is the cost-efficient
    # tier; override with GEMINI_MODEL rather than editing this.
    gemini_model: str = "gemini-3.5-flash-lite"
    gemini_api_url: str = "https://generativelanguage.googleapis.com/v1beta"
    gemini_timeout_seconds: float = 15.0

    # Groq — free, hosted vision fallback for brochure pages when Gemini is
    # unavailable (no key, exhausted quota, or an outage). Chosen over Ollama
    # for this role because Ollama has to be self-hosted, and the deployed API
    # has no Ollama to reach: a fallback that only works on a developer's
    # laptop is not a fallback. OpenAI-compatible, so the call is a plain
    # chat-completions POST. Leave blank to skip this hop.
    groq_api_key: str = ""
    groq_api_url: str = "https://api.groq.com/openai/v1"
    groq_vision_model: str = "meta-llama/llama-4-scout-17b-16e-instruct"
    # Groq accepts at most 5 images per request, fewer than PDF_VISION_MAX_PAGES,
    # so the rendered pages are sent in batches of this size.
    groq_max_images_per_request: int = 5

    # Optional server-side TTS (BR-API-02). "none" disables it and the client
    # falls back to the browser's speechSynthesis, which is the default path.
    tts_provider: str = "none"          # none | google | azure
    tts_api_key: str = ""
    tts_api_url: str = ""
    tts_timeout_seconds: int = 20
    tts_max_chars: int = 3000

    # Qdrant vector database
    qdrant_url: str = "http://localhost:6333"
    qdrant_collection: str = "gaadiiq_listings"
    qdrant_api_key: str = ""  # set QDRANT_API_KEY in production

    # n8n workflow automation
    n8n_webhook_url: str = ""
    n8n_secret: str = ""

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
        if not self.qdrant_api_key:
            errors.append("QDRANT_API_KEY must be set in production")
        if not os.environ.get("METRICS_TOKEN"):
            errors.append("METRICS_TOKEN must be set in production")
        if errors:
            print("FATAL: production configuration errors:", file=sys.stderr)
            for e in errors:
                print(f"  - {e}", file=sys.stderr)
            sys.exit(1)


settings = Settings()
