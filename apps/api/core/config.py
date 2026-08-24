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

    # Database — Single URL (Supabase or Render PostgreSQL)
    database_url: str = "postgresql+asyncpg://user:password@localhost:5432/gaadiiq"

    @property
    def async_database_url(self) -> str:
        url = self.database_url
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+asyncpg://", 1)

        # Fallback: if URL ends with just :5432/ (no database name), append 'postgres'
        # This handles Render env var truncation issues
        if url.endswith(":5432/") or url.endswith(":5432"):
            if not url.endswith("/"):
                url += "/"
            url += "postgres"

        return url

    # Redis
    redis_url: str = "redis://localhost:6379"

    # ── Trusting the proxy in front ───────────────────────────────────────────
    #
    # THE BUG THESE EXIST FOR
    #
    # The rate limiter keyed on CF-Connecting-IP, then X-Forwarded-For, and
    # trusted whichever it found — from any caller. Measured: with a limit of
    # 3/minute, six requests carrying a different forged CF-Connecting-IP each
    # time returned [200, 200, 200, 200, 200, 200]. Every request minted its own
    # bucket, so the limit bounded nothing at all. One header defeated it.
    #
    # A header is only evidence if something we trust set it, and the only thing
    # that makes it trustworthy is knowing the request actually came through
    # that proxy.
    #
    # WHY NOT SIMPLY IGNORE THE HEADERS
    #
    # Because Render terminates TLS and forwards. Falling back to the peer
    # address would put every visitor in one bucket behind Render's proxy, and
    # 300/minute shared by the whole internet is an outage we caused ourselves.
    #
    # So: hop counting by default, and a shared secret once Cloudflare is in
    # front.
    trusted_proxy_hops: int = 1
    #: Set to the same value as the Cloudflare Transform Rule that injects it.
    #: While empty, CF-Connecting-IP is not trusted at all.
    trusted_proxy_secret: str = ""
    trusted_proxy_secret_header: str = "X-Gaadiiq-Origin"
    #: Refuse any request that did not come through the trusted proxy. This is
    #: the origin lock in code: Render's own IP allow-list is the first line,
    #: and this holds even if that is misconfigured or the service is reachable
    #: by another route. Requires trusted_proxy_secret.
    require_trusted_proxy: bool = False

    #: Make an environment mismatch fatal instead of a warning.
    #:
    #: Off by default, and that is the whole point of shipping it this way. A
    #: refuse-to-boot check that is wrong takes the service down on the release
    #: meant to harden it, and this one reasons from a heuristic — the database
    #: host — so it can be wrong in ways a test will not show. Deploy it
    #: warn-only, read the log, and turn it on in a later release once the line
    #: has been seen to say the right thing about a real deployment.
    strict_environment_check: bool = False

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
        "http://127.0.0.1:4200",
        "https://127.0.0.1:4200",
        "capacitor://localhost",
        "ionic://localhost",
        "https://gaadiiq.com",
        "https://www.gaadiiq.com",
        "https://app.gaadiiq.com",
        "https://gaaadiiq-web.vercel.app",
    ]

    # Vercel mints a brand-new hostname for every deployment
    # (gaaadiiq-<hash>-<team>.vercel.app), so a hand-maintained allow-list can
    # never keep up and each preview build fails CORS with an opaque
    # "Failed to fetch" in the browser. Matched by pattern instead.
    #
    # Deliberately anchored and scoped to this project's own names rather than
    # a blanket .vercel.app: allow_credentials is True, so a broad pattern
    # would let any site hosted on Vercel make credentialed calls to this API.
    allowed_origin_regex: str = r"^https://gaaadiiq[a-z0-9-]*\.vercel\.app$"

    # Cloudflare R2 (S3-compatible)
    r2_endpoint_url: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket_name: str = "gaadiiq-media"
    r2_public_url: str = "https://media.gaadiiq.com"
    # SigV4 signing region for the object store.
    #
    # "auto" is correct for Cloudflare R2, which rejects a real region name.
    # Other S3-compatible stores reject "auto" and require their own region —
    # Supabase Storage signs against its project region (e.g. "ap-south-1"), so
    # leaving this hardcoded made the endpoint unusable. Override with
    # MEDIA_S3_REGION when the backend is not R2.
    media_s3_region: str = "auto"

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

    # OpenAI — the first model asked for a diagnosis when nothing in the
    # knowledge base matches, for every tier. It sits ahead of Gemini rather
    # than beside it: Ollama used to hold this slot and its host is not set in
    # any deployed environment, which left free-tier users falling through to
    # the heuristic — a floor, not a finding. Leave the key blank and the
    # ladder skips straight to Gemini.
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    openai_api_url: str = "https://api.openai.com/v1"
    openai_timeout_seconds: float = 20.0

    # ── EV charging station data ─────────────────────────────────────────────
    # Open Charge Map. The key is optional — OCM answers unauthenticated
    # requests — but rate limits are far kinder with one. Server-side only: a
    # key in the Angular bundle is public the moment it ships.
    ocm_api_url: str = "https://api.openchargemap.io/v3"
    ocm_api_key: str = ""

    # ── News provider ────────────────────────────────────────────────────────
    # Which upstream the /news endpoint reads. "google" is the Google News RSS
    # feed and needs no key; "apitube" is APITube's News API and needs one.
    #
    # The key lives here and only here. It is read by the API process, sent
    # from the server to APITube, and never reaches the browser — a key in
    # frontend code is public the moment the bundle ships, and APITube bills
    # per request against it. Set it as an environment variable in Render, not
    # in a file in this repository.
    news_provider: str = "google"
    apitube_api_key: str = ""
    apitube_api_url: str = "https://api.apitube.io/v1/news"
    apitube_timeout_seconds: float = 10.0

    # Gemini — the second model, and the last one before Ollama and the
    # heuristic. Leave the key blank and the ladder skips it.
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

    # Per-image classification (what a picture shows, its angle, its colour).
    # Off by default: it adds a vision call per batch of images on top of the
    # extraction, and the free tiers this runs on are already the binding
    # constraint. Make/model/year come from the brochure text regardless, so
    # leaving this off costs only the angle and colour, not searchability.
    media_classification_enabled: bool = False

    # Per-file cap for admin image uploads, in megabytes. The BRD mentions 15 GB
    # for video territory, which requires resumable/chunked upload (WAVE 3).
    # For WAVE 2, we support high-quality photography (100 MB = ~10-20 full-res images).
    # Set MEDIA_MAX_UPLOAD_MB to override; values >100 MB require infrastructure changes.
    media_max_upload_mb: int = 100

    # Optional server-side TTS (BR-API-02). "none" disables it and the client
    # falls back to the browser's speechSynthesis, which is the default path.
    tts_provider: str = "none"          # none | google | azure
    tts_api_key: str = ""
    tts_api_url: str = ""
    tts_timeout_seconds: int = 20
    tts_max_chars: int = 3000

    # Qdrant vector database, and whether semantic search is on at all.
    #
    # Off by default, and that is the honest default: no Qdrant has ever been
    # provisioned for this product. Until this flag was added, production
    # *required* QDRANT_API_KEY to boot, so the deployed service carried
    # QDRANT_API_KEY="dummy" — the check was satisfied by a value that proved
    # nothing, semantic search silently fell back to rule-based matching, and
    # every listing failed to index against a Qdrant that was not there.
    #
    # A required secret people satisfy with the word "dummy" is worse than no
    # requirement: it blocks a deploy until someone lies to it and then reports
    # success. Turning the feature on is now a deliberate act, and the
    # validation below applies only when it is.
    semantic_search_enabled: bool = False
    qdrant_url: str = "http://localhost:6333"
    qdrant_collection: str = "gaadiiq_listings"
    qdrant_api_key: str = ""

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

    # ── WAVE 3 ML Features ────────────────────────────────────────────────────
    # CLIP embeddings for semantic search
    clip_model_name: str = "sentence-transformers/clip-vit-b-32"
    clip_batch_size: int = 32
    enable_embeddings: bool = False

    # Tesseract OCR
    tesseract_timeout_seconds: int = 30
    enable_ocr: bool = False

    # ── Roadside repair marketplace ───────────────────────────────────────────
    # Off by default. The feature needs an operator-supplied secret
    # (KYC_HASH_PEPPER) that no existing deployment has, and turning the
    # requirement on unconditionally would abort startup on every environment
    # that has not been given one yet. Flip this on once the pepper is set.
    marketplace_enabled: bool = False

    # Platform commission on a completed repair. See services/commission.py for
    # how 10% / ₹49 floor / ₹2,500 cap was arrived at.
    commission_rate_bps: int = 1000
    commission_min_paise: int = 4900
    commission_max_paise: int = 250000

    # Pepper for the one-way Aadhaar digest. MUST be set in production and MUST
    # NOT be rotated casually — changing it orphans every existing digest, so
    # duplicate-registration detection silently stops working.
    kyc_hash_pepper: str = ""

    # Nearest-mechanic search defaults.
    mechanic_search_radius_km: int = 15
    mechanic_search_max_radius_km: int = 50

    # Roadside dispatch. Deliberately much tighter than the browse radius: a
    # broadcast is an interruption sent to someone who did not ask for it, and
    # "within 1 km" is the promise being made to the customer about how fast
    # help can arrive. The re-dispatch path widens it when nobody answers.
    dispatch_radius_km: float = 1.0
    dispatch_max_offers: int = 10
    dispatch_offer_ttl_minutes: int = 10

    # WhatsApp receipts. Blank token = dev mode: messages are logged to the
    # database and marked sent without any outbound call.
    whatsapp_provider: str = "meta_cloud"
    whatsapp_api_token: str = ""
    whatsapp_phone_number_id: str = ""
    whatsapp_api_base: str = "https://graph.facebook.com/v21.0"

    # Payee name shown in the customer's UPI app when they scan the QR.
    upi_payee_name: str = "GAADIIQ"
    # Platform VPA the scan-to-pay QR collects into. Blank disables the QR and
    # leaves Razorpay checkout as the only payment route.
    upi_payee_vpa: str = ""

    # Safety detection (NSFW + license plate)
    yolov8_model_name: str = "yolov8n.pt"
    nsfw_threshold: float = 0.5
    license_plate_confidence_threshold: float = 0.5
    enable_safety_detection: bool = False

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def payments_enabled(self) -> bool:
        """Payments are only real when Razorpay keys are present."""
        return bool(self.RAZORPAY_KEY_ID and self.RAZORPAY_KEY_SECRET)

    def environment_mismatch(self) -> str | None:
        """
        Does the environment we say we are in match the evidence?

        WHY THIS CANNOT LIVE IN validate_production_config

        That method's first two lines are `if not self.is_production: return`.
        Every check it performs is gated on the very flag that might be wrong,
        so a deployment with ENVIRONMENT unset or misspelt skips all of them
        silently — and it is not alone. The same string decides:

          * whether get_admin_user hands an unauthenticated caller a synthetic
            Dev Admin (core/dependencies.py)
          * whether payments accept a dev-mode bypass (routers/payments.py)
          * whether the rate limiter runs at all (core/limiter.py)

        One wrong string is an open admin API, auto-approved payments and no
        rate limiting, at the same time, on real data. So this check runs
        unconditionally and asks the opposite question: never "are we
        configured for production", but "does what we are connected to look
        like production, whatever we called ourselves".

        Returns a description of the disagreement, or None.
        """
        from urllib.parse import urlparse

        url = (self.database_url or "").strip()
        if not url:
            return None

        if url.startswith("sqlite"):
            host = ""
        else:
            try:
                host = (urlparse(url.replace("+asyncpg", "").replace("+psycopg", "")).hostname or "")
            except ValueError:
                # A URL we cannot parse is not evidence of anything. Saying
                # nothing beats a false alarm that trains people to ignore this.
                return None

        host = host.lower()
        local = (
            not host
            or host in ("localhost", "127.0.0.1", "::1", "host.docker.internal")
            or host.endswith(".local")
            or host.startswith("192.168.")
            or host.startswith("10.")
        )

        if not local and not self.is_production:
            return (
                f"ENVIRONMENT is {self.environment!r} but the database is a remote "
                f"host ({host}). In this mode the admin dependency grants a "
                f"synthetic Dev Admin to unauthenticated callers, payments accept "
                f"a dev bypass, and the rate limiter is disabled — against what "
                f"looks like real data."
            )

        if local and self.is_production:
            return (
                f"ENVIRONMENT is 'production' but the database is local ({host or 'sqlite'}). "
                f"Production is pointed at a database that holds nothing."
            )

        return None

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
        # Only when the feature is actually switched on. Placeholder values are
        # rejected explicitly: "dummy" in this slot is how semantic search came
        # to be broken in production for months while the check passed.
        if self.semantic_search_enabled:
            if not self.qdrant_url or "localhost" in self.qdrant_url:
                errors.append(
                    "QDRANT_URL must point at a real cluster when "
                    "SEMANTIC_SEARCH_ENABLED is true"
                )
            if self.qdrant_api_key.strip().lower() in ("", "dummy", "changeme", "placeholder", "todo"):
                errors.append(
                    "QDRANT_API_KEY must be a real key when SEMANTIC_SEARCH_ENABLED "
                    "is true (a placeholder is not a configuration)"
                )
        if not os.environ.get("METRICS_TOKEN"):
            errors.append("METRICS_TOKEN must be set in production")
        # Only when the marketplace is actually switched on. Without a pepper the
        # Aadhaar digest is a plain SHA-256 of a 12-digit number — a space small
        # enough to brute-force exhaustively, which would make the digest as good
        # as storing the number itself. Registration also refuses to run in
        # production without it (see routers/mechanics.py), so a deployment that
        # has not set MARKETPLACE_ENABLED cannot write an unsafe digest either
        # way; failing startup over an unused feature would be the wrong trade.
        if self.marketplace_enabled and not self.kyc_hash_pepper:
            errors.append("KYC_HASH_PEPPER must be set in production (Aadhaar digests are unsafe without it)")

        # Warned rather than fatal, and deliberately loud.
        #
        # The default media backend writes into the container's own filesystem.
        # On a host with no persistent disk — which is how this deploys — every
        # restart deletes every stored image while the vehicle_media rows that
        # reference them survive in Postgres. The result is a catalogue full of
        # broken thumbnails and no error anywhere explaining it, because from
        # the API's point of view each upload succeeded.
        #
        # Not fatal because refusing to boot would take the whole API down over
        # a subsystem that only affects images, which is the wrong trade for a
        # service already serving traffic.
        if os.getenv("MEDIA_BACKEND", "local").lower() != "s3":
            print(
                "WARNING: MEDIA_BACKEND is not 's3' in production. Uploaded images "
                "are being written to the container filesystem and will be LOST on "
                "the next deploy or restart, leaving database rows pointing at files "
                "that no longer exist. Set MEDIA_BACKEND=s3 with the R2_* credentials.",
                file=sys.stderr,
            )

        if errors:
            print("FATAL: production configuration errors:", file=sys.stderr)
            for e in errors:
                print(f"  - {e}", file=sys.stderr)
            sys.exit(1)


settings = Settings()
