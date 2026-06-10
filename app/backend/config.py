"""
Centralized Configuration

Uses pydantic-settings to load and validate configuration from environment variables.
All environment variables are defined and documented in one place.

Usage:
    from config import settings

    # Access configuration values
    print(settings.db_host)
    print(settings.r2_bucket_name)
    print(settings.database_url)
"""

from functools import lru_cache
from typing import Optional, List

from pydantic import Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.

    Environment variables can be set directly or loaded from a .env file.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",  # Ignore extra env vars
    )

    # =========================================================================
    # Database Configuration
    # =========================================================================
    db_host: str = Field(default="localhost", description="Database host")
    db_port: int = Field(default=5432, description="Database port")
    db_name: str = Field(default="canopy", description="Database name")
    db_user: str = Field(default="postgres", description="Database user")
    db_password: str = Field(default="password", description="Database password")
    db_sslmode: str = Field(default="", description="SSL mode for database connection")

    @computed_field  # type: ignore[prop-decorator]
    @property
    def database_url(self) -> str:
        """Generate SQLAlchemy database URL."""
        url = f"postgresql://{self.db_user}:{self.db_password}@{self.db_host}:{self.db_port}/{self.db_name}"
        if self.db_sslmode:
            url += f"?sslmode={self.db_sslmode}"
        return url

    # =========================================================================
    # Cloudflare R2 Storage Configuration
    # =========================================================================
    r2_account_id: Optional[str] = Field(default=None, description="Cloudflare R2 account ID")
    r2_access_key_id: Optional[str] = Field(default=None, description="R2 access key ID")
    r2_secret_access_key: Optional[str] = Field(default=None, description="R2 secret access key")
    r2_bucket_name: str = Field(default="cannwood-media", description="R2 bucket name")

    @property
    def r2_configured(self) -> bool:
        """Check if R2 storage is fully configured."""
        return all([self.r2_account_id, self.r2_access_key_id, self.r2_secret_access_key])

    @property
    def r2_endpoint_url(self) -> Optional[str]:
        """Generate R2 endpoint URL."""
        if self.r2_account_id:
            return f"https://{self.r2_account_id}.r2.cloudflarestorage.com"
        return None

    # =========================================================================
    # CORS Configuration
    # =========================================================================
    cors_origins: str = Field(
        default="",
        description="Comma-separated list of allowed CORS origins"
    )
    cors_origin: str = Field(
        default="",
        description="Single CORS origin (legacy, use cors_origins instead)"
    )

    @property
    def allowed_origins(self) -> List[str]:
        """Get list of allowed CORS origins."""
        if self.cors_origins:
            return [origin.strip() for origin in self.cors_origins.split(",")]
        elif self.cors_origin:
            return [self.cors_origin]
        else:
            return ["http://localhost:5173", "http://127.0.0.1:5173"]

    # =========================================================================
    # Authentication & Security
    # =========================================================================
    session_secret_key: str = Field(
        default="",
        description="Secret key for session encryption (required in production)"
    )
    admin_password: str = Field(
        default="",
        description="Admin password for seeding database"
    )

    # =========================================================================
    # Ecotopia / Druid Tracker Integration
    # =========================================================================
    ecotopia_username: str = Field(
        default="",
        description="Ecotopia portal username (used to obtain a session token via /api/login).",
    )
    ecotopia_password: str = Field(
        default="",
        description="Ecotopia portal password (plaintext; the client hashes it before sending).",
    )

    # =========================================================================
    # Inference
    # =========================================================================
    inference_mode: str = Field(
        default="local",
        description="Where model inference runs: 'local' (in-process) or 'modal' (serverless)"
    )
    modal_app_name: str = Field(
        default="canopy-inference",
        description="Name of the deployed Modal app providing inference functions"
    )

    # =========================================================================
    # Background Job Processing
    # =========================================================================
    job_dispatcher_enabled: bool = Field(
        default=True,
        description="Run the in-process dispatcher that processes pending media jobs"
    )
    job_concurrency: Optional[int] = Field(
        default=None,
        description="Maximum media processing jobs running at once "
                    "(default: 2 for local inference, 16 for modal)"
    )

    @property
    def effective_job_concurrency(self) -> int:
        """Local jobs are CPU-bound; modal jobs just wait on the network."""
        if self.job_concurrency is not None:
            return self.job_concurrency
        return 16 if self.inference_mode.lower() == "modal" else 2
    job_poll_interval_seconds: float = Field(
        default=3.0,
        description="How often the dispatcher polls for pending jobs"
    )
    job_max_attempts: int = Field(
        default=3,
        description="Processing attempts before a job is marked failed"
    )
    job_timeout_seconds: int = Field(
        default=1800,
        description="Per-job timeout; jobs stuck in 'processing' are requeued after 1.5x this"
    )

    # =========================================================================
    # Environment
    # =========================================================================
    env: str = Field(default="development", description="Environment name")

    @property
    def is_production(self) -> bool:
        """Check if running in production environment."""
        return self.env.lower() in ("production", "prod", "staging")

    @property
    def is_development(self) -> bool:
        """Check if running in development environment."""
        return not self.is_production


@lru_cache
def get_settings() -> Settings:
    """
    Get cached settings instance.

    Uses lru_cache to ensure settings are only loaded once.
    """
    return Settings()


# Convenience export for direct import
settings = get_settings()
