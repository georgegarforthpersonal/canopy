"""
Cloudflare R2 Storage Service

Provides S3-compatible storage operations for media files (audio and images).
Configuration is loaded from the centralized config module.
"""

from enum import Enum
from pathlib import Path
from typing import Optional, BinaryIO, Any

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from config import settings


class MediaType(str, Enum):
    """Supported media types for R2 storage."""
    AUDIO = "audio"
    IMAGE = "images"


# Default content types for each media type
DEFAULT_CONTENT_TYPES = {
    MediaType.AUDIO: "audio/wav",
    MediaType.IMAGE: "image/jpeg",
}


def get_r2_client() -> Any:
    """Create and return an R2 client using boto3."""
    if not settings.r2_configured:
        raise ValueError(
            "R2 credentials not configured. "
            "Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY"
        )

    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        config=Config(signature_version="s3v4"),
    )


# ============================================================================
# Generic Media Functions
# ============================================================================

def upload_media_file(
    file_data: BinaryIO,
    filename: str,
    org_slug: str,
    media_type: MediaType,
    content_type: Optional[str] = None,
) -> str:
    """
    Upload a media file to R2.

    Args:
        file_data: File-like object with media data
        filename: Original filename
        org_slug: Organisation slug for path prefix
        media_type: Type of media (AUDIO or IMAGE)
        content_type: MIME type (uses default for media_type if not provided)

    Returns:
        R2 key for the uploaded file
    """
    client = get_r2_client()
    r2_key = f"{media_type.value}/{org_slug}/{filename}"

    if content_type is None:
        content_type = DEFAULT_CONTENT_TYPES[media_type]

    client.upload_fileobj(
        file_data,
        settings.r2_bucket_name,
        r2_key,
        ExtraArgs={"ContentType": content_type},
    )

    return r2_key


def download_media_file(r2_key: str, local_path: Path) -> Path:
    """
    Download a media file from R2 to a local path.

    Args:
        r2_key: R2 object key
        local_path: Local path to save file

    Returns:
        Path to downloaded file
    """
    client = get_r2_client()
    client.download_file(settings.r2_bucket_name, r2_key, str(local_path))
    return local_path


def delete_media_file(r2_key: str) -> bool:
    """
    Delete a media file from R2.

    Args:
        r2_key: R2 object key

    Returns:
        True if deleted successfully
    """
    client = get_r2_client()
    try:
        client.delete_object(Bucket=settings.r2_bucket_name, Key=r2_key)
        return True
    except ClientError:
        return False


def delete_media_files(r2_keys: list[str]) -> int:
    """
    Delete multiple media files from R2 in a single batch.

    Args:
        r2_keys: List of R2 object keys to delete

    Returns:
        Number of files successfully deleted
    """
    if not r2_keys:
        return 0

    client = get_r2_client()
    # S3 delete_objects supports up to 1000 keys per request
    deleted = 0
    for i in range(0, len(r2_keys), 1000):
        batch = r2_keys[i : i + 1000]
        try:
            response = client.delete_objects(
                Bucket=settings.r2_bucket_name,
                Delete={"Objects": [{"Key": key} for key in batch], "Quiet": True},
            )
            deleted += len(batch) - len(response.get("Errors", []))
        except ClientError:
            pass
    return deleted


def generate_media_presigned_url(r2_key: str, expires_in: int = 3600) -> str:
    """
    Generate a presigned URL for downloading/previewing a file.

    Args:
        r2_key: R2 object key
        expires_in: URL expiry time in seconds (default: 1 hour)

    Returns:
        Presigned URL string
    """
    client = get_r2_client()
    url: str = client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.r2_bucket_name, "Key": r2_key},
        ExpiresIn=expires_in,
    )
    return url


def get_file_metadata(r2_key: str) -> Optional[dict]:
    """
    Get metadata for a file in R2.

    Returns:
        Dict with size, content_type, last_modified, or None if not found
    """
    client = get_r2_client()
    try:
        response = client.head_object(Bucket=settings.r2_bucket_name, Key=r2_key)
        return {
            "size": response.get("ContentLength"),
            "content_type": response.get("ContentType"),
            "last_modified": response.get("LastModified"),
        }
    except ClientError:
        return None


# ============================================================================
# Backward Compatibility Aliases - Audio
# ============================================================================

def upload_audio_file(
    file_data: BinaryIO,
    filename: str,
    org_slug: str,
    content_type: str = "audio/wav",
) -> str:
    """Upload an audio file to R2. (Alias for backward compatibility)"""
    return upload_media_file(file_data, filename, org_slug, MediaType.AUDIO, content_type)


def download_audio_file(r2_key: str, local_path: Path) -> Path:
    """Download an audio file from R2. (Alias for backward compatibility)"""
    return download_media_file(r2_key, local_path)


def delete_audio_file(r2_key: str) -> bool:
    """Delete an audio file from R2. (Alias for backward compatibility)"""
    return delete_media_file(r2_key)


def generate_presigned_url(r2_key: str, expires_in: int = 3600) -> str:
    """Generate a presigned URL for audio. (Alias for backward compatibility)"""
    return generate_media_presigned_url(r2_key, expires_in)


# ============================================================================
# Backward Compatibility Aliases - Images
# ============================================================================

def upload_image_file(
    file_data: BinaryIO,
    filename: str,
    org_slug: str,
    content_type: str = "image/jpeg",
) -> str:
    """Upload an image file to R2. (Alias for backward compatibility)"""
    return upload_media_file(file_data, filename, org_slug, MediaType.IMAGE, content_type)


def download_image_file(r2_key: str, local_path: Path) -> Path:
    """Download an image file from R2. (Alias for backward compatibility)"""
    return download_media_file(r2_key, local_path)


def delete_image_file(r2_key: str) -> bool:
    """Delete an image file from R2. (Alias for backward compatibility)"""
    return delete_media_file(r2_key)


def generate_image_presigned_url(r2_key: str, expires_in: int = 3600) -> str:
    """Generate a presigned URL for images. (Alias for backward compatibility)"""
    return generate_media_presigned_url(r2_key, expires_in)
