"""
Media processing jobs (BirdNET audio analysis, camera trap classification).

These functions are run by the job dispatcher (services/job_queue.py): it
claims a pending row, calls the matching function here in a worker thread,
and handles retry/failure status transitions. Functions raise on failure.

Each function is idempotent — existing detections for the row are replaced,
so a retried or manually re-triggered job never duplicates results. Heavy
model inference happens between two short-lived DB sessions so no connection
is held open during the ~30s of compute (Neon's pooler reaps idle sockets,
which causes SSL EOF errors on the next query).
"""

import logging
import tempfile
from datetime import datetime
from pathlib import Path

from sqlmodel import col

from database.connection import get_session_factory
from models import (
    AudioDetection,
    AudioRecording,
    CameraTrapDetection,
    CameraTrapImage,
    ProcessingStatus,
    Species,
    SpeciesType,
)
from services.r2_storage import download_audio_file, download_image_file

logger = logging.getLogger(__name__)

# Default coordinates for location-based species filtering
DEFAULT_LAT = 51.3452
DEFAULT_LON = -2.2525


def process_audio_recording(recording_id: int) -> None:
    """Analyse an audio recording with BirdNET and store its detections."""
    from services.bird_audio import analyze_file, get_db_scientific_name, get_location_species

    SessionLocal = get_session_factory()
    with SessionLocal() as db:
        recording = db.query(AudioRecording).filter(AudioRecording.id == recording_id).first()
        if not recording:
            logger.error(f"Recording {recording_id} not found for processing")
            return
        r2_key = recording.r2_key
        filename = recording.filename
        survey_id = recording.survey_id

    with tempfile.TemporaryDirectory() as tmpdir:
        local_path = Path(tmpdir) / filename
        download_audio_file(r2_key, local_path)
        species_list = get_location_species(DEFAULT_LAT, DEFAULT_LON)
        detections = analyze_file(local_path, species_list)

    scientific_names = {get_db_scientific_name(det.species) for det in detections}

    with SessionLocal() as db:
        recording = db.query(AudioRecording).filter(AudioRecording.id == recording_id).first()
        if not recording:
            return

        species_rows = (
            db.query(Species)
            .join(Species.species_type)
            .filter(
                col(Species.scientific_name).in_(scientific_names),
                SpeciesType.name == "bird",
            )
            .all()
        )
        species_by_scientific_name = {s.scientific_name: s for s in species_rows}

        # Replace any detections from a previous (partial) run
        db.query(AudioDetection).filter(
            AudioDetection.audio_recording_id == recording_id
        ).delete()

        unmatched: list[str] = []
        matched_count = 0
        for det in detections:
            species = species_by_scientific_name.get(get_db_scientific_name(det.species))
            if species:
                db.add(AudioDetection(
                    audio_recording_id=recording_id,
                    survey_id=survey_id,
                    species_name=det.species,
                    species_id=species.id,
                    confidence=det.confidence,
                    start_time=det.start,
                    end_time=det.end,
                    detection_timestamp=det.timestamp,
                ))
                matched_count += 1
            elif det.species not in unmatched:
                unmatched.append(det.species)

        recording.unmatched_species = unmatched if unmatched else None
        recording.processing_status = ProcessingStatus.completed
        recording.processing_completed_at = datetime.utcnow()
        db.commit()

    logger.info(
        f"Processed recording {recording_id}: {matched_count} matched detections, "
        f"{len(unmatched)} unmatched species"
    )


def process_camera_trap_image(image_id: int) -> None:
    """Classify a camera trap image and store its detections."""
    from services.camera_trap import analyze_image, get_classifier

    SessionLocal = get_session_factory()
    with SessionLocal() as db:
        image = db.query(CameraTrapImage).filter(CameraTrapImage.id == image_id).first()
        if not image:
            logger.error(f"Image {image_id} not found for processing")
            return
        r2_key = image.r2_key
        filename = image.filename

    if not get_classifier().load():
        raise RuntimeError("Species classification model failed to load")

    with tempfile.TemporaryDirectory() as tmpdir:
        local_path = Path(tmpdir) / filename
        download_image_file(r2_key, local_path)
        result = analyze_image(local_path)

    scientific_names = {p["scientific_name"] for p in result.top_predictions}

    with SessionLocal() as db:
        image = db.query(CameraTrapImage).filter(CameraTrapImage.id == image_id).first()
        if not image:
            return

        species_rows = (
            db.query(Species)
            .filter(col(Species.scientific_name).in_(scientific_names))
            .all()
        )
        species_by_scientific_name = {s.scientific_name: s for s in species_rows}

        # Replace any detections from a previous (partial) run
        db.query(CameraTrapDetection).filter(
            CameraTrapDetection.camera_trap_image_id == image_id
        ).delete()

        unmatched: list[str] = []
        matched_count = 0

        if result.classification:
            species = species_by_scientific_name.get(result.classification.scientific_name)
            db.add(CameraTrapDetection(
                camera_trap_image_id=image_id,
                species_name=result.classification.common_name,
                scientific_name=result.classification.scientific_name,
                confidence=result.classification.confidence,
                taxonomic_level=result.classification.taxonomic_level,
                species_id=species.id if species else None,
                is_primary=True,
            ))
            if species:
                matched_count += 1
            elif result.classification.scientific_name not in unmatched:
                unmatched.append(result.classification.scientific_name)

        for pred in result.top_predictions[1:5]:  # Skip first (already stored as primary)
            species = species_by_scientific_name.get(pred["scientific_name"])
            db.add(CameraTrapDetection(
                camera_trap_image_id=image_id,
                species_name=pred["common_name"],
                scientific_name=pred["scientific_name"],
                confidence=pred["confidence"],
                taxonomic_level="species",
                species_id=species.id if species else None,
                is_primary=False,
            ))

        image.flagged_for_review = result.flagged_for_review
        image.review_reason = result.review_reason
        image.unmatched_species = unmatched if unmatched else None
        image.processing_status = ProcessingStatus.completed
        image.processing_completed_at = datetime.utcnow()
        db.commit()

    logger.info(
        f"Processed image {image_id}: {matched_count} matched detections, "
        f"{len(unmatched)} unmatched species, flagged={result.flagged_for_review}"
    )
