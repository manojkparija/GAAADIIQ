import logging
import warnings

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings

# Fail fast in production if secrets are missing/default
settings.validate_production_config()

if settings.secret_key == "change-me-in-production":
    warnings.warn(
        "SECRET_KEY is set to the insecure default. Set the SECRET_KEY environment variable before deploying.",
        stacklevel=1,
    )
    logging.getLogger("gaadiiq").warning("SECRET_KEY is using the insecure default value.")

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

# Hide API docs in production
_docs_url = None if settings.is_production else "/docs"
_redoc_url = None if settings.is_production else "/redoc"

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    docs_url=_docs_url,
    redoc_url=_redoc_url,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
