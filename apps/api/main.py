import asyncio
import logging
import os
import secrets
import subprocess
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from core.config import settings
from core.limiter import limiter

# Debug: Verify configuration is loaded (redact credentials)
async_url = settings.async_database_url
db_redacted = "***redacted***" if settings.database_url else "NOT SET"
async_redacted = "***redacted***" if async_url else "NOT SET"
print(f"[DEBUG] DATABASE_URL = {db_redacted}")
print(f"[DEBUG] ASYNC_DATABASE_URL = {async_redacted}")
print(f"[DEBUG] ENVIRONMENT = {settings.environment}")

# Fail fast in production if secrets are missing/default
settings.validate_production_config()

if not settings.jwt_private_key and not settings.is_production:
    logging.getLogger("gaadiiq").warning(
        "JWT_PRIVATE_KEY not set — using ephemeral RSA keypair (tokens reset on restart). "
        "Set JWT_PRIVATE_KEY and JWT_PUBLIC_KEY before deploying."
    )

from routers import (  # noqa: E402
    admin,
    advisor,
    auth,
    bookings,
    brochures,
    cars,
    challan,
    dealers,
    demand,
    diagnosis,
    diagnosis_kb,
    ev_charging,
    health,
    insurance,
    leads,
    listings,
    loan_applications,
    loans,
    mechanics,
    media_admin,
    news,
    notifications,
    otp,
    payments,
    price_alerts,
    recommend,
    resale,
    reviews,
    search,
    sentiment,
    service_requests,
    upload,
    valuation,
    video_reviews,
)
from services.scheduler import start_scheduler, stop_scheduler  # noqa: E402

# ── Prometheus metrics ─────────────────────────────────────────────────────────
_REQUEST_COUNT = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["method", "path", "status"],
)
_REQUEST_LATENCY = Histogram(
    "http_request_duration_seconds",
    "HTTP request latency",
    ["method", "path"],
)

# AI-specific metrics (imported by services/valuation.py and routers/recommend.py)
AI_VALUATION_LATENCY = Histogram(
    "ai_valuation_latency_seconds",
    "Time spent running valuation (Ollama or heuristic)",
    ["method"],
)
AI_FALLBACK_TOTAL = Counter(
    "ai_fallback_total",
    "Number of times heuristic fallback was used instead of Ollama",
)
RECOMMEND_REQUESTS_TOTAL = Counter(
    "recommend_requests_total",
    "Total calls to POST /recommend",
)

# Without this, nothing the application logs is ever emitted. A logger with no
# handler falls back to the root logger, which defaults to WARNING and has no
# handler of its own, so every _log.info in this codebase went nowhere — which
# is why "Alembic: …" never appeared in the deployment logs and a database the
# application could not read looked exactly like a healthy one.
#
# force=True because uvicorn installs its own handlers first; without it this
# call is a no-op under the server that actually runs in production, which is
# the only place it matters.
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s [%(name)s] %(message)s",
    force=True,
)

_log = logging.getLogger("gaadiiq")

# Hide API docs in production
_docs_url = None if settings.is_production else "/docs"
_redoc_url = None if settings.is_production else "/redoc"


async def _fix_schema():
    """Apply missing schema columns at startup (non-fatal if DB unavailable)."""
    from urllib.parse import urlparse

    import asyncpg

    try:
        # Parse database URL
        db_url = settings.async_database_url
        db_url = db_url.replace("postgresql+asyncpg://", "postgresql://")
        parsed = urlparse(db_url)

        # Connect directly with timeout
        conn = await asyncio.wait_for(
            asyncpg.connect(
                host=parsed.hostname,
                port=parsed.port,
                user=parsed.username,
                password=parsed.password,
                database=parsed.path.lstrip("/"),
                # See db/session.py: Supabase's chain fails verification, so
                # encrypt without verifying rather than fail to connect at all.
                ssl="require",
                timeout=5,
            ),
            timeout=10,
        )

        try:
            # Add missing revoked column to refresh_tokens
            await conn.execute(
                "ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS revoked BOOLEAN NOT NULL DEFAULT FALSE;"
            )
            _log.info("Schema: refresh_tokens.revoked column ensured")

            # vehicle_diagnoses.listing_id is NOT NULL in production and
            # appears in no model or migration — drift that predates both.
            # Nothing sets it, so every INSERT raised NotNullViolationError and
            # every POST /diagnosis/analyse returned 500. Migration 0035 is the
            # real fix; this repeats it at boot because the endpoint is on the
            # request path and a migration that did not run leaves the whole
            # feature dead.
            #
            # Idempotent: DROP NOT NULL on an already-nullable column is a
            # no-op, and the guard skips a database that has no such column.
            await conn.execute(
                """
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'vehicle_diagnoses'
                          AND column_name = 'listing_id'
                          AND is_nullable = 'NO'
                    ) THEN
                        ALTER TABLE vehicle_diagnoses
                            ALTER COLUMN listing_id DROP NOT NULL;
                    END IF;
                END $$;
                """
            )
            _log.info("Schema: vehicle_diagnoses.listing_id nullability ensured")

            # `notification_type` is absent from this database and short a
            # label wherever it is present, so dispatching a job 500'd on the
            # notification insert and took the offer rows with it. Migration
            # 0036 is the real fix; this repeats it at boot for the same reason
            # the listing_id repair is here — dispatch is on the request path,
            # and a migration that did not run leaves the feature dead.
            #
            # Idempotent: CREATE is guarded and ADD VALUE uses IF NOT EXISTS.
            await conn.execute(
                """
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
                        -- Direct DDL, not EXECUTE: quoting a label list inside
                        -- EXECUTE needs every quote doubled, and getting that
                        -- wrong is a syntax error at boot rather than a caught
                        -- failure. plpgsql runs DDL directly.
                        CREATE TYPE notification_type AS ENUM (
                            'booking_received', 'booking_confirmed', 'booking_cancelled',
                            'loan_inquiry_received', 'price_drop', 'listing_viewed',
                            'job_offer', 'system'
                        );
                    END IF;
                END $$;
                """
            )
            for _label in (
                "booking_received", "booking_confirmed", "booking_cancelled",
                "loan_inquiry_received", "price_drop", "listing_viewed",
                "job_offer", "system",
            ):
                await conn.execute(
                    f"ALTER TYPE notification_type ADD VALUE IF NOT EXISTS '{_label}'"
                )
            _log.info("Schema: notification_type labels ensured")
        finally:
            await conn.close()
    except Exception as e:
        _log.debug("Schema fix skipped (db unavailable): %s", str(e)[:50])


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run DB migrations on startup (skip in development if DB is unavailable)
    try:
        api_dir = os.path.dirname(os.path.abspath(__file__))
        result = subprocess.run(
            ["alembic", "upgrade", "head"],
            capture_output=True, text=True, check=False,
            cwd=api_dir,
            timeout=60,  # Reconciling a legacy table takes longer than creating one
        )

        # Alembic reports on stderr, not stdout: its progress lines, the
        # migrations it applied, RAISE WARNING from a migration, and the
        # traceback when one fails all arrive there. Logging only stdout
        # printed "Alembic: up to date" whether the upgrade had succeeded,
        # failed, or never run — which is how a database whose listings and
        # cars tables the application could not read went unnoticed through
        # dozens of restarts.
        detail = (result.stderr or result.stdout or "").strip()

        if result.returncode != 0:
            # check=False, so a failed upgrade never raised and the except
            # clauses below were unreachable. The application would then serve
            # traffic against a schema it cannot read, which fails later, far
            # from the cause. In production that is worth refusing to start
            # for; in development an unavailable database is routine.
            _log.error("Alembic upgrade failed (exit %s):\n%s", result.returncode, detail)
            if settings.is_production:
                raise RuntimeError(
                    f"Database migration failed (exit {result.returncode}). "
                    "Refusing to start against a schema the application cannot read."
                )
            _log.warning("Continuing without migrations (development mode)")
            await _fix_schema()
        else:
            _log.info("Alembic upgrade complete:\n%s", detail or "already at head")
            # A migration that could not finish its job says so with RAISE
            # WARNING rather than failing — reconciling a legacy table can
            # need a decision no migration should make alone. Surface those at
            # error level so they are not lost among the progress lines.
            for line in detail.splitlines():
                if "WARNING" in line:
                    _log.error("Migration warning: %s", line.strip())
    except subprocess.TimeoutExpired:
        if settings.is_production:
            _log.error("Alembic migration timeout")
            raise
        else:
            _log.warning("Alembic migration timeout (development mode) - will retry with direct schema fix")
            await _fix_schema()
    except subprocess.CalledProcessError as exc:
        stderr_msg = exc.stderr or "(no stderr captured)"
        stdout_msg = exc.stdout or "(no stdout captured)"
        error_text = f"Alembic stderr:\n{stderr_msg}\nAlembic stdout:\n{stdout_msg}"
        _log.error(error_text)
        if settings.is_production:
            raise
        else:
            _log.warning("Alembic migration skipped (development mode) - attempting direct schema fix")
            await _fix_schema()
    except FileNotFoundError:
        _log.warning("Alembic command not found in PATH; skipping database migrations")
        await _fix_schema()

    # After the migrations, so this reports what they left rather than what
    # they were about to fix. A SELECT fails on the first column Postgres
    # cannot resolve and says nothing about the rest, so finding these one at a
    # time costs a deploy each; this finds all of them in one startup.
    from db.schema_drift import report_schema_drift
    from db.session import engine
    await report_schema_drift(engine)

    start_scheduler()

    # Two subsystems that degrade silently by design. That is right for
    # resilience and it is exactly why nobody noticed: nothing breaks visibly
    # when a cache falls back to a dict or a model is simply absent. Say it
    # once at boot so the state is in the log rather than only inferable from
    # a hit rate nobody is watching.
    if settings.is_production:
        if not settings.redis_url:
            _log.warning(
                "REDIS_URL is not set — OTP digests and the diagnosis response "
                "cache are using a per-process dict. Correct, but not shared "
                "across workers and lost on restart."
            )
        if not (
            settings.openai_api_key
            or settings.gemini_api_key
            or "localhost" not in settings.ollama_base_url
        ):
            _log.warning(
                "No diagnosis model is reachable (no OPENAI_API_KEY, no "
                "GEMINI_API_KEY, no OLLAMA_BASE_URL). A symptom that misses "
                "the knowledge base will be answered by the heuristic "
                "fallback, which is keyword overlap rather than a diagnosis."
            )

    # Semantic search is opt-in. When it is off there is no cluster to reach,
    # and calling this only produced a connection-refused warning on every boot
    # — the kind of permanent warning people learn to scroll past.
    if settings.semantic_search_enabled:
        from services.vector_store import ensure_collection
        if ensure_collection():
            _log.info("Qdrant collection ready: %s", settings.qdrant_collection)
        else:
            _log.warning(
                "SEMANTIC_SEARCH_ENABLED is on but Qdrant is unreachable at %s — "
                "search and recommendations will fall back to rule-based matching",
                settings.qdrant_url,
            )
    else:
        _log.info("Semantic search disabled (SEMANTIC_SEARCH_ENABLED unset)")

    # ── WAVE 3 ML Model Initialization ────────────────────────────────────────
    if settings.enable_embeddings:
        try:
            from services.embeddings_clip import ensure_model_loaded
            if ensure_model_loaded():
                _log.info("CLIP embedding model loaded")
        except Exception as e:
            _log.warning(f"Failed to load CLIP model (embeddings disabled): {e}")

    if settings.enable_ocr:
        _log.info("Tesseract OCR enabled (model loaded on first use)")

    if settings.enable_safety_detection:
        try:
            from services.safety_detection import ensure_models_loaded
            if ensure_models_loaded():
                _log.info("Safety detection models (NSFW + YOLOv8) loaded")
        except Exception as e:
            _log.warning(f"Failed to load safety detection models: {e}")

    yield
    stop_scheduler()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    docs_url=_docs_url,
    redoc_url=_redoc_url,
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# WITHOUT THIS, THE DEFAULT LIMIT DOES NOTHING.
#
# slowapi applies @limiter.limit decorators through the decorator itself, but
# default_limits are enforced only by SlowAPIMiddleware. This app registered the
# limiter and the exception handler and not the middleware — which was fine
# while every protected endpoint carried its own decorator, and became the whole
# problem the moment protection was supposed to cover the endpoints that do not.
#
# Adding default_limits to the Limiter without this line would have looked like
# a fix, passed a test that reads the Limiter's attributes, and left 117
# endpoints exactly as unlimited as before. test_limiter_storage.py drives a
# real undecorated route to a 429 rather than inspecting configuration, which is
# the only version of that test that can fail for the right reason.
#
# ORDERING, for the same reason the comment below gives: registered BEFORE
# CORSMiddleware so CORS stays the outer layer and a 429 goes out with
# Access-Control-Allow-Origin. A rate-limit response the browser is not allowed
# to read is reported to the user as "could not reach the API", which sends
# whoever investigates to the wrong machine.
app.add_middleware(SlowAPIMiddleware)

@app.middleware("http")
async def _unhandled_error_middleware(request: Request, call_next):
    """
    Turn an unhandled exception into a 500 the browser is allowed to read.

    Starlette's ServerErrorMiddleware sits above CORSMiddleware, so a crash it
    handles produces a 500 carrying no Access-Control-Allow-Origin header. The
    browser then refuses to expose the response and reports a network failure,
    which reaches the frontend as status 0 — indistinguishable from the API
    being unreachable. A server-side traceback was surfacing in the UI as
    "Could not reach the API", sending debugging to the wrong machine entirely.

    ORDERING IS LOAD-BEARING: this must be registered BEFORE CORSMiddleware.
    Starlette's add_middleware inserts at position 0, so the last registration
    is the outermost layer — registering this after CORS would place it outside,
    and the response would again go out without the header. test_error_cors.py
    fails if the two are swapped.
    """
    try:
        return await call_next(request)
    except Exception:
        # The traceback goes to the server log; the client gets a generic
        # message. Exception text may name table or column internals, which
        # belong in logs rather than in a browser.
        _log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error. Check the API logs for the traceback."},
        )


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_origin_regex=settings.allowed_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=600,
)

# Prometheus scrape token — set METRICS_TOKEN env var in production;
# falls back to a random per-process token in dev (logged at startup).
_METRICS_TOKEN: str = os.environ.get("METRICS_TOKEN", "") or secrets.token_hex(32)
if not os.environ.get("METRICS_TOKEN"):
    _log.warning("METRICS_TOKEN not set — /metrics uses ephemeral token (changes on restart)")


@app.middleware("http")
async def _security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(self)"
    if settings.is_production:
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
        # This service returns JSON and nothing else — in production /docs and
        # /redoc are disabled, so no response of ours has any business loading
        # a script, a style or an image. Saying so turns a response that a
        # browser can be talked into rendering as HTML into an inert one.
        #
        # Production only: in development the Swagger UI at /docs pulls its
        # assets from a CDN, and 'none' would leave an empty page.
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
        )
    return response


@app.middleware("http")
async def _metrics_middleware(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration = time.perf_counter() - start
    path = request.url.path
    _REQUEST_LATENCY.labels(method=request.method, path=path).observe(duration)
    _REQUEST_COUNT.labels(method=request.method, path=path, status=response.status_code).inc()
    return response


@app.get("/metrics", include_in_schema=False)
async def metrics(request: Request):
    """Prometheus scrape endpoint — requires Bearer token via METRICS_TOKEN env var."""
    auth = request.headers.get("Authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    if settings.is_production and not secrets.compare_digest(token, _METRICS_TOKEN):
        return Response(status_code=401, content="Unauthorized")
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


app.include_router(health.router)
app.include_router(auth.router)
app.include_router(diagnosis_kb.router)
app.include_router(otp.router)
app.include_router(leads.router)
app.include_router(admin.router)
app.include_router(cars.router)
app.include_router(listings.router)
app.include_router(dealers.router)
app.include_router(demand.router)
app.include_router(bookings.router)
app.include_router(search.router)
app.include_router(loans.router)
# Mounted after `loans` and sharing its /loans prefix: the two are one surface to
# a caller, and splitting the file only keeps the older seller-lead flow apart
# from the application module rather than giving it a separate URL space.
app.include_router(loan_applications.router)
app.include_router(notifications.router)
app.include_router(price_alerts.router)
app.include_router(recommend.router)
app.include_router(advisor.router)
app.include_router(reviews.router)
app.include_router(payments.router)
app.include_router(payments.subs_router)
app.include_router(sentiment.router)
app.include_router(diagnosis.router)
app.include_router(brochures.router)
app.include_router(news.router)
app.include_router(brochures.media_router)
app.include_router(media_admin.router)
app.include_router(upload.router)
app.include_router(challan.router)
app.include_router(insurance.router)
app.include_router(ev_charging.router)
app.include_router(video_reviews.router)
app.include_router(resale.router)
app.include_router(valuation.router)
app.include_router(mechanics.router)
app.include_router(service_requests.router)


@app.get("/")
async def root():
    return {"message": "GAADIIQ API", "version": settings.app_version}
