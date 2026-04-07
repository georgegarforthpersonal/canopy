"""
Camera Trap Images Router - API endpoints for camera trap image analysis

Endpoints:
  GET    /api/surveys/{survey_id}/images              - List images for survey
  POST   /api/surveys/{survey_id}/images              - Upload image file(s)
  GET    /api/surveys/{survey_id}/images/{id}         - Get image details
  DELETE /api/surveys/{survey_id}/images/{id}         - Delete image
  POST   /api/surveys/{survey_id}/images/{id}/process - Trigger processing (manual)
  GET    /api/surveys/{survey_id}/images/{id}/detections - Get detections for image
  GET    /api/surveys/{survey_id}/image-detections/summary - Aggregated by species
  POST   /api/surveys/filter-images                   - Run MegaDetector false positive filter
  GET    /api/images/{id}/download                    - Get presigned download URL
  GET    /api/images/{id}/preview                     - Get presigned preview URL
"""

import json
import logging
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, List, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy import func, desc
from sqlalchemy.orm import Session
from sqlmodel import col

from auth import require_admin
from database.connection import get_db, get_session_factory
from dependencies import get_current_organisation
from models import (
    CameraTrapImage,
    CameraTrapImageRead,
    CameraTrapDetection,
    CameraTrapDetectionRead,
    Device,
    ImageDetectionOption,
    ImageWithDetections,
    Location,
    Organisation,
    ProcessingStatus,
    Species,
    Survey,
    SurveyImageDetectionsResponse,
    SurveyTypeSpeciesTypeLink,
)
from services.r2_storage import (
    delete_image_file,
    download_image_file,
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


def extract_image_info(filename: str) -> dict:
    """Extract device serial and timestamp from filename."""
    info = extract_media_info(filename)
    return {"device_serial": info.device_serial, "image_timestamp": info.timestamp}


def _build_image_response(image: CameraTrapImage, detection_count: int) -> dict:
    """Build response dict for a camera trap image."""
    return {
        "id": image.id,
        "survey_id": image.survey_id,
        "filename": image.filename,
        "r2_key": image.r2_key,
        "file_size_bytes": image.file_size_bytes,
        "image_timestamp": image.image_timestamp,
        "device_serial": image.device_serial,
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


@filter_router.post("/filter-images")
async def filter_images_for_false_positives(
    files: List[UploadFile] = File(...),
    org: Organisation = Depends(get_current_organisation),
) -> dict:
    """
    Run MegaDetector on uploaded images to identify false positives.
    Returns per-image detection results. Does not persist images.
    """
    from services.megadetector import get_detector

    detector = get_detector()
    if not detector.load():
        raise HTTPException(
            status_code=503,
            detail="MegaDetector model failed to load. Try again or skip filtering.",
        )

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

        with tempfile.NamedTemporaryFile(suffix=ext, delete=True) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp.flush()

            detection = detector.detect(Path(tmp.name))

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


@filter_router.post("/classify-species")
async def classify_species(
    files: List[UploadFile] = File(...),
    detections_json: str = Form(...),
    survey_type_id: int = Form(...),
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> dict:
    """
    Classify species in camera trap images using cropped bounding boxes.

    Accepts image files alongside JSON metadata describing bounding boxes
    (from MegaDetector). Each image is cropped to its animal bounding boxes,
    classified with EVA02, and predictions are matched against the species
    database filtered by survey type.
    """
    from PIL import Image as PILImage

    from services.camera_trap import crop_and_classify, get_classifier

    classifier = get_classifier()
    if not classifier.load():
        raise HTTPException(
            status_code=503,
            detail="Species classification model failed to load. Try again or skip detection.",
        )

    try:
        detections_list = json.loads(detections_json)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid detections_json format")

    if len(detections_list) != len(files):
        raise HTTPException(
            status_code=400,
            detail=f"Mismatch: {len(files)} files but {len(detections_list)} detection entries",
        )

    # Load species for this survey type (same query as species router)
    survey_species = (
        db.query(Species)
        .join(
            SurveyTypeSpeciesTypeLink,
            SurveyTypeSpeciesTypeLink.species_type_id == Species.species_type_id,
        )
        .filter(SurveyTypeSpeciesTypeLink.survey_type_id == survey_type_id)
        .all()
    )

    # Build lookup indices for matching
    sci_name_map: dict[str, Species] = {}
    genus_map: dict[str, Species] = {}
    for sp in survey_species:
        if sp.scientific_name:
            sci_name_map[sp.scientific_name.lower()] = sp
            genus = sp.scientific_name.lower().split()[0] if " " in sp.scientific_name else ""
            if genus:
                genus_map[genus] = sp  # Last one wins — genus-level fallback only

    def match_species(scientific_name: str, common_name: str) -> dict:
        """Match a prediction to the species DB. Returns species_id + display name."""
        sci_lower = scientific_name.lower()

        # 1. Exact match on scientific name
        if sci_lower in sci_name_map:
            sp = sci_name_map[sci_lower]
            return {"species_id": sp.id, "species_name": sp.name or common_name}

        # 2. Prefix match (e.g. "Vulpes vulpes vulpes" -> "Vulpes vulpes")
        for db_sci, sp in sci_name_map.items():
            if sci_lower.startswith(db_sci) or db_sci.startswith(sci_lower):
                return {"species_id": sp.id, "species_name": sp.name or common_name}

        # 3. No match
        return {"species_id": None, "species_name": common_name}

    results = []

    for file, detection_info in zip(files, detections_list):
        ext = Path(file.filename or "unknown.jpg").suffix.lower()
        if ext not in IMAGE_EXTENSIONS:
            results.append({
                "filename": file.filename,
                "suggestions": [],
                "error": f"Unsupported file type: {ext}",
            })
            continue

        with tempfile.NamedTemporaryFile(suffix=ext, delete=True) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp.flush()

            try:
                pil_image = PILImage.open(tmp.name)
            except Exception as e:
                results.append({
                    "filename": file.filename,
                    "suggestions": [],
                    "error": f"Failed to open image: {e}",
                })
                continue

            boxes = detection_info.get("boxes", [])
            all_predictions = crop_and_classify(pil_image, boxes, top_k=3)

            # Collect best prediction per box, deduplicate by species
            seen_species: set[str] = set()
            suggestions = []

            for preds in all_predictions:
                if not preds:
                    continue
                top = preds[0]
                sci_key = top["scientific_name"].lower()
                if sci_key in seen_species:
                    continue
                seen_species.add(sci_key)

                match = match_species(top["scientific_name"], top["common_name"])
                suggestions.append({
                    "scientific_name": top["scientific_name"],
                    "common_name": top["common_name"],
                    "confidence": round(top["confidence"], 4),
                    "species_id": match["species_id"],
                    "species_name": match["species_name"],
                })

            results.append({
                "filename": file.filename,
                "suggestions": suggestions,
            })

    return {"results": results}


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


@router.post(
    "/{survey_id}/images",
    response_model=List[CameraTrapImageRead],
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
async def upload_images(
    survey_id: int,
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    skip_processing: bool = Query(False, description="Skip AI processing (for manual classification)"),
    metadata: Optional[str] = Form(None, description="JSON mapping filename to ISO timestamp"),
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """
    Upload one or more camera trap images to a survey.
    Files are stored in R2 and processing is auto-triggered unless skip_processing=true.
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

        # Extract metadata from filename (fallback) or use provided timestamps
        info = extract_image_info(file.filename)
        image_timestamp = info["image_timestamp"]
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
            device_serial=info["device_serial"],
            image_timestamp=image_timestamp,
            processing_status=initial_status,
        )
        db.add(image)
        db.flush()  # Get the ID

        uploaded.append(image)

        # Auto-trigger background processing (unless skipped)
        if not skip_processing:
            background_tasks.add_task(process_image_background, image_id=image.id)

    db.commit()

    # Build response
    return [_build_image_response(img, 0) for img in uploaded]


@router.post(
    "/{survey_id}/images/{image_id}/process",
    dependencies=[Depends(require_admin)],
)
async def process_image(
    survey_id: int,
    image_id: int,
    background_tasks: BackgroundTasks,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """
    Manually trigger processing for a camera trap image.
    Processing runs in background; poll status via GET endpoint.
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

    # Mark as processing
    image.processing_status = ProcessingStatus.processing
    image.processing_started_at = datetime.utcnow()
    image.processing_error = None
    db.commit()

    # Queue background processing
    background_tasks.add_task(process_image_background, image_id=image_id)

    return {"status": "processing", "message": "Processing started"}


def process_image_background(image_id: int) -> None:
    """Background task to process image with species classification."""
    from services.camera_trap import analyze_image

    SessionLocal = get_session_factory()
    db = SessionLocal()

    try:
        image = (
            db.query(CameraTrapImage)
            .filter(CameraTrapImage.id == image_id)
            .first()
        )
        if not image:
            logger.error(f"Image {image_id} not found for processing")
            return

        # Update status to processing
        image.processing_status = ProcessingStatus.processing
        image.processing_started_at = datetime.utcnow()
        db.commit()

        # Download file to temp location
        with tempfile.TemporaryDirectory() as tmpdir:
            local_path = Path(tmpdir) / image.filename
            download_image_file(image.r2_key, local_path)

            # Run species classification
            result = analyze_image(local_path)

            # Store detections, tracking unmatched species
            unmatched = []
            matched_count = 0

            # Store top prediction as primary
            if result.classification:
                species = db.query(Species).filter(
                    Species.scientific_name == result.classification.scientific_name
                ).first()

                detection = CameraTrapDetection(
                    camera_trap_image_id=image_id,
                    species_name=result.classification.common_name,
                    scientific_name=result.classification.scientific_name,
                    confidence=result.classification.confidence,
                    taxonomic_level=result.classification.taxonomic_level,
                    species_id=species.id if species else None,
                    is_primary=True,
                )
                db.add(detection)

                if species:
                    matched_count += 1
                else:
                    if result.classification.scientific_name not in unmatched:
                        unmatched.append(result.classification.scientific_name)

            # Store top 5 predictions as non-primary
            for pred in result.top_predictions[1:5]:  # Skip first (already stored as primary)
                species = db.query(Species).filter(
                    Species.scientific_name == pred["scientific_name"]
                ).first()

                detection = CameraTrapDetection(
                    camera_trap_image_id=image_id,
                    species_name=pred["common_name"],
                    scientific_name=pred["scientific_name"],
                    confidence=pred["confidence"],
                    taxonomic_level="species",
                    species_id=species.id if species else None,
                    is_primary=False,
                )
                db.add(detection)

            # Store flagging status from analysis
            image.flagged_for_review = result.flagged_for_review
            image.review_reason = result.review_reason
            image.unmatched_species = unmatched if unmatched else None

            # Update image status
            image.processing_status = ProcessingStatus.completed
            image.processing_completed_at = datetime.utcnow()
            db.commit()

            logger.info(
                f"Processed image {image_id}: {matched_count} matched detections, "
                f"{len(unmatched)} unmatched species, flagged={result.flagged_for_review}"
            )

    except Exception as e:
        logger.exception(f"Error processing image {image_id}")
        try:
            image = (
                db.query(CameraTrapImage)
                .filter(CameraTrapImage.id == image_id)
                .first()
            )
            if image:
                image.processing_status = ProcessingStatus.failed
                image.processing_error = str(e)
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


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


@router.get(
    "/{survey_id}/image-detections/summary",
    response_model=SurveyImageDetectionsResponse,
)
async def get_image_detections_summary(
    survey_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> SurveyImageDetectionsResponse:
    """
    Get image detections for a survey - one row per image with top 3 species.
    Images are grouped by device for frontend device tabs.
    """
    # Verify survey belongs to org
    survey = (
        db.query(Survey)
        .filter(Survey.id == survey_id, Survey.organisation_id == org.id)
        .first()
    )
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")

    # Get all completed images for this survey
    images = (
        db.query(CameraTrapImage)
        .filter(
            CameraTrapImage.survey_id == survey_id,
            CameraTrapImage.processing_status == ProcessingStatus.completed,
        )
        .order_by(CameraTrapImage.image_timestamp.desc())  # type: ignore[union-attr]
        .all()
    )

    if not images:
        return SurveyImageDetectionsResponse(images=[])

    # Build mapping from device_serial to device info
    device_serials = set(img.device_serial for img in images if img.device_serial)
    device_map = {}
    if device_serials:
        devices = (
            db.query(
                Device,
                col(Location.name).label("location_name"),
                func.ST_Y(Device.point_geometry).label("lat"),
                func.ST_X(Device.point_geometry).label("lng"),
            )
            .outerjoin(Location, Device.location_id == Location.id)
            .filter(
                col(Device.device_id).in_(device_serials),
                Device.organisation_id == org.id,
            )
            .all()
        )
        for device, loc_name, lat, lng in devices:
            device_map[device.device_id] = {
                "device_id": device.device_id,
                "device_name": device.name,
                "device_latitude": lat,
                "device_longitude": lng,
                "location_id": device.location_id,
                "location_name": loc_name,
            }

    result = []
    for img in images:
        # Get top 3 detections for this image (by confidence)
        detections = (
            db.query(CameraTrapDetection)
            .filter(CameraTrapDetection.camera_trap_image_id == img.id)
            .order_by(desc(CameraTrapDetection.confidence))
            .limit(3)
            .all()
        )

        if not detections:
            continue  # Skip images with no detections

        device_info = device_map.get(img.device_serial, {})

        result.append(
            ImageWithDetections(
                image_id=img.id,
                filename=img.filename,
                device_id=img.device_serial,
                device_name=device_info.get("device_name"),
                device_latitude=device_info.get("device_latitude"),
                device_longitude=device_info.get("device_longitude"),
                location_id=device_info.get("location_id"),
                location_name=device_info.get("location_name"),
                detections=[
                    ImageDetectionOption(
                        species_id=det.species_id,
                        species_name=det.species_name,
                        scientific_name=det.scientific_name,
                        confidence=det.confidence,
                    )
                    for det in detections
                ],
            )
        )

    return SurveyImageDetectionsResponse(images=result)


@router.delete(
    "/{survey_id}/images/{image_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin)],
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
