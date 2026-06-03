"""
FastAPI Backend for Wildlife Survey Management System

This API provides RESTful endpoints for managing surveys, species, locations, and sightings.
Following DEVELOPMENT.md conventions, this backend separates concerns while reusing
database logic from the Streamlit POC.
"""

import logging
import os

import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import settings
from exceptions import AppException
from routers import surveys, species, locations, surveyors, dashboard, survey_types, auth, audio, devices, images, export, ecotopia

logger = logging.getLogger(__name__)

# Initialize Sentry error monitoring
sentry_sdk.init(
    dsn=os.environ.get("SENTRY_DSN"),
    traces_sample_rate=0.1,
)

# Initialize FastAPI app
app = FastAPI(
    title="Wildlife Survey API",
    description="API for managing butterfly and wildlife surveys",
    version="2.0.0",
    docs_url="/api/docs",  # Swagger UI
    redoc_url="/api/redoc",  # ReDoc
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
    """Handle custom application exceptions with consistent JSON responses."""
    logger.error(f"{exc.__class__.__name__}: {exc.message}", extra=exc.context)
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )


# ============================================================================
# Include Routers - Organize endpoints by resource
# ============================================================================

app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(surveys.router, prefix="/api/surveys", tags=["Surveys"])
app.include_router(audio.router, prefix="/api/surveys", tags=["Audio"])
app.include_router(audio.download_router, prefix="/api/audio", tags=["Audio"])
app.include_router(images.router, prefix="/api/surveys", tags=["Images"])
app.include_router(images.filter_router, prefix="/api/surveys", tags=["Images"])
app.include_router(images.download_router, prefix="/api/images", tags=["Images"])
app.include_router(species.router, prefix="/api/species", tags=["Species"])
app.include_router(locations.router, prefix="/api/locations", tags=["Locations"])
app.include_router(surveyors.router, prefix="/api/surveyors", tags=["Surveyors"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(survey_types.router, prefix="/api/survey-types", tags=["Survey Types"])
app.include_router(devices.router, prefix="/api/devices", tags=["Devices"])
app.include_router(export.router, prefix="/api/export", tags=["Export"])
app.include_router(ecotopia.router, prefix="/api/ecotopia", tags=["Ecotopia"])

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
