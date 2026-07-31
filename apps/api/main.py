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

from core.config import settings
from core.limiter import limiter

# Debug: Verify configuration is loaded
_log = logging.getLogger("gaadiiq")
_log.info("DEBUG: DATABASE_URL = %s", settings.database_url[:80] if settings.database_url else "NOT SET")
_log.info("DEBUG: ENVIRONMENT = %s", settings.environment)

# Fail fast in production if secrets are missing/default
settings.validate_production_config()

if not settings.jwt_private_key and not settings.is_production:
    logging.getLogger("gaadiiq").warning(
        "JWT_PRIVATE_KEY not set — using ephemeral RSA keypair (tokens reset on restart). "
        "Set JWT_PRIVATE_KEY and JWT_PUBLIC_KEY before deploying."
    )

from routers import (  # noqa: E402
    admin,
    auth,
    bookings,
    brochures,
    cars,
    dealers,
    diagnosis,
    health,
    insurance,
    listings,
    loans,
    media_admin,
    notifications,
    otp,
    payments,
    price_alerts,
    recommend,
    reviews,
    search,
    sentiment,
    upload,
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

_log = logging.getLogger("gaadiiq")

# Hide API docs in production
_docs_url = None if settings.is_production else "/docs"
_redoc_url = None if settings.is_production else "/redoc"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run DB migrations on startup (skip in development if DB is unavailable)
    try:
        api_dir = os.path.dirname(os.path.abspath(__file__))
        result = subprocess.run(
            ["alembic", "upgrade", "head"],
            capture_output=True, text=True, check=True,
            cwd=api_dir,
        )
        _log.info("Alembic: %s", result.stdout.strip() or "up to date")
    except subprocess.CalledProcessError as exc:
        if settings.is_production:
            _log.error("Alembic migration failed stdout=%s stderr=%s", exc.stdout, exc.stderr)
            raise
        else:
            _log.warning("Alembic migration skipped (development mode): %s", exc.stderr[:200] if exc.stderr else "unknown error")
    except FileNotFoundError:
        _log.warning("Alembic command not found in PATH; skipping database migrations")

    start_scheduler()

    # Initialise vector store collection (non-fatal if Qdrant is offline)
    from services.vector_store import ensure_collection
    ensure_collection()

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
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Request-ID"],
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
app.include_router(otp.router)
app.include_router(admin.router)
app.include_router(cars.router)
app.include_router(listings.router)
app.include_router(dealers.router)
app.include_router(bookings.router)
app.include_router(search.router)
app.include_router(loans.router)
app.include_router(notifications.router)
app.include_router(price_alerts.router)
app.include_router(recommend.router)
app.include_router(reviews.router)
app.include_router(payments.router)
app.include_router(payments.subs_router)
app.include_router(sentiment.router)
app.include_router(diagnosis.router)
app.include_router(brochures.router)
app.include_router(brochures.media_router)
app.include_router(media_admin.router)
app.include_router(upload.router)
app.include_router(insurance.router)


@app.get("/")
async def root():
    return {"message": "GAADIIQ API", "version": settings.app_version}
