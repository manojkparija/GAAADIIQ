import logging
import time

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from core.config import settings
from core.limiter import limiter

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
    cars,
    dealers,
    health,
    listings,
    loans,
    notifications,
    payments,
    price_alerts,
    reviews,
    search,
)

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

# Hide API docs in production
_docs_url = None if settings.is_production else "/docs"
_redoc_url = None if settings.is_production else "/redoc"

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    docs_url=_docs_url,
    redoc_url=_redoc_url,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
async def metrics():
    """Prometheus scrape endpoint — restrict to internal network in production."""
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


app.include_router(health.router)
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(cars.router)
app.include_router(listings.router)
app.include_router(dealers.router)
app.include_router(bookings.router)
app.include_router(search.router)
app.include_router(loans.router)
app.include_router(notifications.router)
app.include_router(price_alerts.router)
app.include_router(reviews.router)
app.include_router(payments.router)
app.include_router(payments.subs_router)


@app.get("/")
async def root():
    return {"message": "GAADIIQ API", "version": settings.app_version}
