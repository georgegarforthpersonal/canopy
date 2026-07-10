"""
FastAPI Backend for Wildlife Survey Management System

This API provides RESTful endpoints for managing surveys, species, locations, and sightings.
Following DEVELOPMENT.md conventions, this backend separates concerns while reusing
database logic from the Streamlit POC.
"""

import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

import sentry_sdk
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from auth import require_user
from config import settings
from exceptions import AppException
from routers import surveys, species, locations, surveyors, dashboard, survey_types, auth, audio, devices, images, export, ecotopia
from services.job_queue import start_dispatcher, stop_dispatcher

logger = logging.getLogger(__name__)

# Initialize Sentry error monitoring
sentry_sdk.init(
    dsn=os.environ.get("SENTRY_DSN"),
    environment=settings.env,
    traces_sample_rate=0.1,
)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Run the media job dispatcher for the lifetime of the app."""
    if settings.job_dispatcher_enabled:
        await start_dispatcher()
    yield
    if settings.job_dispatcher_enabled:
        await stop_dispatcher()


# Initialize FastAPI app
app = FastAPI(
    title="Wildlife Survey API",
    description="API for managing butterfly and wildlife surveys",
    version="2.0.0",
    docs_url="/api/docs",  # Swagger UI
    redoc_url="/api/redoc",  # ReDoc
    lifespan=lifespan,
)

# ============================================================================
# CORS Configuration - Allow React frontend to call API
# ============================================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# Global Exception Handlers
# ============================================================================

@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    """Handle custom application exceptions with consistent JSON responses.

    Sentry's logging integration promotes ERROR-level logs to Sentry events,
    so only 5xx exceptions are logged at ERROR — expected client errors
    (404, 401, validation) would otherwise flood Sentry with noise.
    """
    if exc.status_code >= 500:
        logger.error(f"{exc.__class__.__name__}: {exc.message}", extra=exc.context)
    else:
        logger.warning(f"{exc.__class__.__name__}: {exc.message}", extra=exc.context)
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Return unhandled errors as JSON the browser is allowed to read.

    Starlette serves this response from ServerErrorMiddleware, *outside*
    CORSMiddleware, so the CORS headers must be set by hand — without them a
    cross-origin fetch can't read the 500 and rejects with a bare
    "Failed to fetch". Starlette re-raises the exception after sending the
    response, so it still reaches the server log and Sentry.
    """
    headers = {}
    origin = request.headers.get("origin")
    if origin and origin in settings.allowed_origins:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
        headers=headers,
    )


# ============================================================================
# Include Routers - Organize endpoints by resource
# ============================================================================

# The auth router is the only one reachable anonymously (login, invites,
# password reset). Every data router requires a logged-in account of any
# role — reads included; write endpoints additionally declare the editor or
# admin role they need.
authenticated = [Depends(require_user)]

app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(surveys.router, prefix="/api/surveys", tags=["Surveys"], dependencies=authenticated)
app.include_router(audio.router, prefix="/api/surveys", tags=["Audio"], dependencies=authenticated)
app.include_router(audio.download_router, prefix="/api/audio", tags=["Audio"], dependencies=authenticated)
app.include_router(images.router, prefix="/api/surveys", tags=["Images"], dependencies=authenticated)
app.include_router(images.filter_router, prefix="/api/surveys", tags=["Images"], dependencies=authenticated)
app.include_router(images.download_router, prefix="/api/images", tags=["Images"], dependencies=authenticated)
app.include_router(species.router, prefix="/api/species", tags=["Species"], dependencies=authenticated)
app.include_router(locations.router, prefix="/api/locations", tags=["Locations"], dependencies=authenticated)
app.include_router(surveyors.router, prefix="/api/surveyors", tags=["Surveyors"], dependencies=authenticated)
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["Dashboard"], dependencies=authenticated)
app.include_router(survey_types.router, prefix="/api/survey-types", tags=["Survey Types"], dependencies=authenticated)
app.include_router(devices.router, prefix="/api/devices", tags=["Devices"], dependencies=authenticated)
app.include_router(export.router, prefix="/api/export", tags=["Export"], dependencies=authenticated)
app.include_router(ecotopia.router, prefix="/api/ecotopia", tags=["Ecotopia"], dependencies=authenticated)

# ============================================================================
# Health Check Endpoint
# ============================================================================

@app.get("/api/health")
async def health_check() -> dict[str, str]:
    """Check if API is running"""
    return {"status": "healthy", "version": "2.0.0"}

@app.get("/")
async def root() -> dict[str, str]:
    """Root endpoint - redirect to docs"""
    return {
        "message": "Wildlife Survey API",
        "docs": "/api/docs",
        "health": "/api/health"
    }
