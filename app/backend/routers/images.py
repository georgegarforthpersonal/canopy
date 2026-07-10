"""
Camera Trap Images Router - API endpoints for camera trap image analysis

Endpoints:
  GET    /api/surveys/{survey_id}/images              - List images for survey
  POST   /api/surveys/{survey_id}/images              - Upload image file(s)
  GET    /api/surveys/{survey_id}/images/{id}         - Get image details
  DELETE /api/surveys/{survey_id}/images/{id}         - Delete image
  POST   /api/surveys/{survey_id}/images/{id}/process - Trigger processing (manual)
  GET    /api/surveys/{survey_id}/images/{id}/detections - Get detections for image
  POST   /api/surveys/filter-images                   - Run MegaDetector false positive filter
  GET    /api/images/{id}/download                    - Get presigned download URL
  GET    /api/images/{id}/preview                     - Get presigned preview URL
"""

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, List, Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, desc
from sqlalchemy.orm import Session

from auth import require_editor
from database.connection import get_db
from dependencies import get_current_organisation
from models import (
    CameraTrapImage,
    CameraTrapImageRead,
    CameraTrapDetection,
    CameraTrapDetectionRead,
    Organisation,
    ProcessingStatus,
    ProcessingSummary,
    Survey,
)
from services.r2_storage import (
    delete_image_file,
    generate_image_presigned_url,
    upload_image_file,
)
from utils.filename_parser import extract_media_info

logger = logging.getLogger(__name__)

router = APIRouter()
filter_router = APIRouter()

# Accepted image extensions
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp"}

# Content type mapping
CONTENT_TYPE_MAP = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
    ".bmp": "image/bmp",
}


def _build_image_response(image: CameraTrapImage, detection_count: int) -> dict:
    """Build response dict for a camera trap image."""
    return {
        "id": image.id,
        "survey_id": image.survey_id,
        "filename": image.filename,
        "r2_key": image.r2_key,
        "file_size_bytes": image.file_size_bytes,
        "image_timestamp": image.image_timestamp,
        "processing_status": image.processing_status.value
        if hasattr(image.processing_status, "value")
        else image.processing_status,
        "processing_error": image.processing_error,
        "flagged_for_review": image.flagged_for_review,
        "review_reason": image.review_reason,
        "created_at": image.created_at,
        "detection_count": detection_count,
        "unmatched_species": image.unmatched_species,
        "megadetector_confidence": image.megadetector_confidence,
        "is_false_positive": image.is_false_positive,
    }


@filter_router.post("/filter-images", dependencies=[Depends(require_editor)])
async def filter_images_for_false_positives(
    files: List[UploadFile] = File(...),
    org: Organisation = Depends(get_current_organisation),
) -> dict:
    """
    Run MegaDetector on uploaded images to identify false positives.
    Returns per-image detection results. Does not persist images.
    """
    from services.inference import InferenceError, detect_animals_bytes

    results = []
    animal_count = 0
    empty_count = 0
    person_count = 0

    for file in files:
        ext = Path(file.filename or "unknown.jpg").suffix.lower()
        if ext not in IMAGE_EXTENSIONS:
            results.append({
                "filename": file.filename,
                "has_animal": True,  # Safe default
                "max_confidence": 0.0,
                "categories": [],
                "error": f"Unsupported file type: {ext}",
            })
            animal_count += 1
            continue

        content = await file.read()
        try:
            # Blocking inference (local model or Modal call); keep it off
            # the event loop.
            detection = await run_in_threadpool(
                detect_animals_bytes, content, file.filename or f"unknown{ext}"
            )
        except InferenceError:
            raise HTTPException(
                status_code=503,
                detail="MegaDetector model failed to load. Try again or skip filtering.",
            )

        results.append({
            "filename": file.filename,
            "has_animal": detection.has_animal,
            "max_confidence": detection.max_animal_confidence,
            "categories": detection.categories_found,
            "detections": [
                {
                    "x": box.x,
                    "y": box.y,
                    "w": box.w,
                    "h": box.h,
                    "confidence": box.confidence,
                    "category": box.category,
                }
                for box in detection.boxes
            ],
        })

        if detection.has_animal:
            animal_count += 1
        else:
            empty_count += 1
        if "person" in detection.categories_found:
            person_count += 1

    return {
        "results": results,
        "total": len(results),
        "animal_count": animal_count,
        "empty_count": empty_count,
        "person_count": person_count,
    }


@router.get("/{survey_id}/images", response_model=List[CameraTrapImageRead])
async def list_images(
    survey_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """List all camera trap images for a survey."""
    # Verify survey belongs to org
    survey = (
        db.query(Survey)
        .filter(Survey.id == survey_id, Survey.organisation_id == org.id)
        .first()
    )
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")

    images = (
        db.query(CameraTrapImage)
        .filter(CameraTrapImage.survey_id == survey_id)
        .order_by(CameraTrapImage.image_timestamp.desc())  # type: ignore[union-attr]
        .all()
    )

    result = []
    for img in images:
        detection_count = (
            db.query(func.count(CameraTrapDetection.id))
            .filter(CameraTrapDetection.camera_trap_image_id == img.id)
            .scalar()
        )
        result.append(_build_image_response(img, detection_count))
    return result


# NOTE: must be declared before /{survey_id}/images/{image_id} so the
# literal segment wins over the path parameter.
@router.get("/{survey_id}/images/processing-summary", response_model=ProcessingSummary)
async def get_image_processing_summary(
    survey_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> ProcessingSummary:
    """Counts of camera trap images by processing status, for progress display."""
    survey = (
        db.query(Survey)
        .filter(Survey.id == survey_id, Survey.organisation_id == org.id)
        .first()
    )
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")

    rows = (
        db.query(CameraTrapImage.processing_status, func.count(CameraTrapImage.id))
        .filter(CameraTrapImage.survey_id == survey_id)
        .group_by(CameraTrapImage.processing_status)
        .all()
    )
    counts = {str(status_value): count for status_value, count in rows}
    return ProcessingSummary(
        pending=counts.get("pending", 0),
        processing=counts.get("processing", 0),
        completed=counts.get("completed", 0),
        failed=counts.get("failed", 0),
        total=sum(counts.values()),
    )


@router.post(
    "/{survey_id}/images",
    response_model=List[CameraTrapImageRead],
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_editor)],
)
async def upload_images(
    survey_id: int,
    files: List[UploadFile] = File(...),
    skip_processing: bool = Query(False, description="Skip AI processing (for manual classification)"),
    metadata: Optional[str] = Form(None, description="JSON mapping filename to ISO timestamp"),
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """
    Upload one or more camera trap images to a survey.
    Files are stored in R2. Pending images are picked up by the job
    dispatcher unless skip_processing=true.
    """
    # Verify survey belongs to org
    survey = (
        db.query(Survey)
        .filter(Survey.id == survey_id, Survey.organisation_id == org.id)
        .first()
    )
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")

    # Parse optional metadata (filename -> ISO timestamp mapping)
    timestamps_map: dict[str, str] = {}
    if metadata:
        try:
            timestamps_map = json.loads(metadata)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid metadata JSON")

    uploaded = []
    for file in files:
        # Validate file extension
        ext = Path(file.filename).suffix.lower()
        if ext not in IMAGE_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file type: {file.filename}. Accepted: {', '.join(IMAGE_EXTENSIONS)}",
            )

        # Check for duplicate
        existing = (
            db.query(CameraTrapImage)
            .filter(
                CameraTrapImage.survey_id == survey_id,
                CameraTrapImage.filename == file.filename,
            )
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=400, detail=f"File already exists: {file.filename}"
            )

        # Extract timestamp from filename (fallback) or use provided timestamps
        image_timestamp = extract_media_info(file.filename).timestamp
        if file.filename in timestamps_map:
            try:
                image_timestamp = datetime.fromisoformat(timestamps_map[file.filename])
            except (ValueError, TypeError):
                pass  # Fall back to filename-extracted timestamp

        # Get file size
        file.file.seek(0, 2)  # Seek to end
        file_size = file.file.tell()
        file.file.seek(0)  # Reset

        # Upload to R2 (scope by survey_id to avoid filename collisions across surveys)
        content_type = CONTENT_TYPE_MAP.get(ext, "image/jpeg")
        scoped_filename = f"survey_{survey_id}/{file.filename}"
        r2_key = upload_image_file(file.file, scoped_filename, org.slug, content_type)

        # Create database record
        initial_status = ProcessingStatus.completed if skip_processing else ProcessingStatus.pending
        image = CameraTrapImage(
            survey_id=survey_id,
            filename=file.filename,
            r2_key=r2_key,
            file_size_bytes=file_size,
            image_timestamp=image_timestamp,
            processing_status=initial_status,
        )
        db.add(image)
        db.flush()  # Get the ID

        uploaded.append(image)

    db.commit()

    # Build response
    return [_build_image_response(img, 0) for img in uploaded]


@router.post(
    "/{survey_id}/images/{image_id}/process",
    dependencies=[Depends(require_editor)],
)
async def process_image(
    survey_id: int,
    image_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """
    Manually (re)queue processing for a camera trap image.
    The job dispatcher picks it up; poll status via GET endpoint.
    """
    image = (
        db.query(CameraTrapImage)
        .join(Survey)
        .filter(
            CameraTrapImage.id == image_id,
            CameraTrapImage.survey_id == survey_id,
            Survey.organisation_id == org.id,
        )
        .first()
    )
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    if image.processing_status == ProcessingStatus.processing:
        raise HTTPException(
            status_code=400, detail="Image is already being processed"
        )

    # Requeue with a fresh attempt budget
    image.processing_status = ProcessingStatus.pending
    image.processing_attempts = 0
    image.processing_error = None
    db.commit()

    return {"status": "queued", "message": "Processing queued"}


@router.get("/{survey_id}/images/{image_id}", response_model=CameraTrapImageRead)
async def get_image(
    survey_id: int,
    image_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Get details of a specific camera trap image."""
    image = (
        db.query(CameraTrapImage)
        .join(Survey)
        .filter(
            CameraTrapImage.id == image_id,
            CameraTrapImage.survey_id == survey_id,
            Survey.organisation_id == org.id,
        )
        .first()
    )
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    detection_count = (
        db.query(func.count(CameraTrapDetection.id))
        .filter(CameraTrapDetection.camera_trap_image_id == image_id)
        .scalar()
    )

    return _build_image_response(image, detection_count)


@router.get(
    "/{survey_id}/images/{image_id}/detections",
    response_model=List[CameraTrapDetectionRead],
)
async def get_image_detections(
    survey_id: int,
    image_id: int,
    min_confidence: float = 0.0,
    primary_only: bool = False,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """Get species detections for a camera trap image."""
    # Verify access
    image = (
        db.query(CameraTrapImage)
        .join(Survey)
        .filter(
            CameraTrapImage.id == image_id,
            CameraTrapImage.survey_id == survey_id,
            Survey.organisation_id == org.id,
        )
        .first()
    )
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    query = db.query(CameraTrapDetection).filter(
        CameraTrapDetection.camera_trap_image_id == image_id
    )
    if min_confidence > 0:
        query = query.filter(CameraTrapDetection.confidence >= min_confidence)
    if primary_only:
        query = query.filter(CameraTrapDetection.is_primary == True)

    detections = query.order_by(desc(CameraTrapDetection.confidence)).all()

    return [
        {
            "id": d.id,
            "species_name": d.species_name,
            "scientific_name": d.scientific_name,
            "confidence": d.confidence,
            "taxonomic_level": d.taxonomic_level,
            "is_primary": d.is_primary,
            "species_id": d.species_id,
        }
        for d in detections
    ]


@router.delete(
    "/{survey_id}/images/{image_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_editor)],
)
async def delete_image(
    survey_id: int,
    image_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> None:
    """Delete a camera trap image and its detections."""
    image = (
        db.query(CameraTrapImage)
        .join(Survey)
        .filter(
            CameraTrapImage.id == image_id,
            CameraTrapImage.survey_id == survey_id,
            Survey.organisation_id == org.id,
        )
        .first()
    )
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    # Delete from R2
    delete_image_file(image.r2_key)

    # Delete from database (cascades to detections)
    db.delete(image)
    db.commit()
    return None


# Separate router for download/preview endpoints (different path structure)
download_router = APIRouter()


@download_router.get("/{image_id}/download")
async def get_download_url(
    image_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Get a presigned URL to download a camera trap image."""
    image = (
        db.query(CameraTrapImage)
        .join(Survey)
        .filter(CameraTrapImage.id == image_id, Survey.organisation_id == org.id)
        .first()
    )
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    url = generate_image_presigned_url(image.r2_key, expires_in=3600)
    return {"download_url": url, "expires_in": 3600}


@download_router.get("/{image_id}/preview")
async def get_preview_url(
    image_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Get a presigned URL to preview a camera trap image (same as download for now)."""
    image = (
        db.query(CameraTrapImage)
        .join(Survey)
        .filter(CameraTrapImage.id == image_id, Survey.organisation_id == org.id)
        .first()
    )
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")

    url = generate_image_presigned_url(image.r2_key, expires_in=3600)
    return {"preview_url": url, "expires_in": 3600}
