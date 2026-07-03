"""
Audio Recordings Router - API endpoints for bird audio analysis

Endpoints:
  POST   /api/surveys/process-audio                  - Process audio files with BirdNET (no storage)
  GET    /api/surveys/{survey_id}/audio              - List audio recordings for survey
  POST   /api/surveys/{survey_id}/audio              - Upload audio file(s)
  GET    /api/surveys/{survey_id}/audio/{id}         - Get audio recording details
  DELETE /api/surveys/{survey_id}/audio/{id}         - Delete audio recording
  POST   /api/surveys/{survey_id}/audio/{id}/process - Trigger processing (manual)
  GET    /api/surveys/{survey_id}/audio/{id}/detections - Get detections for recording
  GET    /api/audio/{id}/download                    - Get presigned download URL
"""

import logging
from datetime import time
from typing import Any, List

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlmodel import col

from auth import require_editor
from database.connection import get_db, get_session_factory
from dependencies import get_current_organisation
from models import (
    AudioDetectionResult,
    AudioProcessingResponse,
    AudioRecording,
    AudioRecordingRead,
    AudioDetection,
    AudioDetectionRead,
    FileProcessingResult,
    Organisation,
    ProcessingStatus,
    ProcessingSummary,
    Species,
    SpeciesType,
    Survey,
    SurveyDetectionsSaveRequest,
    SurveyDetectionsSaveResponse,
)
from services.processing import DEFAULT_LAT, DEFAULT_LON
from services.r2_storage import (
    delete_audio_file,
    generate_presigned_url,
    upload_audio_file,
)
from utils.filename_parser import extract_media_info

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post(
    "/process-audio",
    response_model=AudioProcessingResponse,
    dependencies=[Depends(require_editor)],
)
async def process_audio_files(
    files: List[UploadFile] = File(...),
    lat: float = Query(DEFAULT_LAT, description="Latitude for location-based species filtering"),
    lon: float = Query(DEFAULT_LON, description="Longitude for location-based species filtering"),
    org: Organisation = Depends(get_current_organisation),
) -> AudioProcessingResponse:
    """
    Process audio files with BirdNET and return detections.
    Files are NOT stored — this is for the audio wizard preview.
    """
    from services.bird_audio import get_db_scientific_name
    from services.inference import analyze_audio_bytes

    SessionLocal = get_session_factory()
    results = []
    for file in files:
        if not file.filename or not file.filename.lower().endswith(".wav"):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file type: {file.filename}. Only WAV files accepted.",
            )

        content = await file.read()
        try:
            # Inference is CPU-bound locally (~30s per file) or a blocking
            # network call on Modal; run off the event loop and without
            # holding a DB connection (Neon's pooler reaps idle sockets,
            # which causes SSL EOF errors on the next query).
            detections = await run_in_threadpool(
                analyze_audio_bytes, content, file.filename, lat, lon
            )
        except Exception as e:
            logger.exception(f"Error processing {file.filename}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to process {file.filename}: {str(e)}",
            )

        scientific_names = {get_db_scientific_name(det.species) for det in detections}

        with SessionLocal() as db:
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

        file_detections = []
        unmatched: list[str] = []
        for det in detections:
            scientific_name = get_db_scientific_name(det.species)
            species = species_by_scientific_name.get(scientific_name)

            if species:
                file_detections.append(
                    AudioDetectionResult(
                        species_name=det.species,
                        species_id=species.id,
                        species_common_name=species.name,
                        species_scientific_name=species.scientific_name,
                        confidence=det.confidence,
                        start_time=det.start.strftime("%H:%M:%S"),
                        end_time=det.end.strftime("%H:%M:%S"),
                        detection_timestamp=det.timestamp,
                    )
                )
            elif det.species not in unmatched:
                unmatched.append(det.species)

        results.append(
            FileProcessingResult(
                filename=file.filename,
                detections=file_detections,
                unmatched_species=unmatched,
            )
        )

    return AudioProcessingResponse(results=results)


def _parse_hms(value: str) -> time:
    h, m, s = value.split(":")
    return time(int(h), int(m), int(s))


@router.post(
    "/{survey_id}/audio/detections",
    response_model=SurveyDetectionsSaveResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_editor)],
)
async def save_survey_detections(
    survey_id: int,
    payload: SurveyDetectionsSaveRequest,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> SurveyDetectionsSaveResponse:
    """Persist BirdNET detections for a survey without storing the source audio."""
    survey = (
        db.query(Survey)
        .filter(Survey.id == survey_id, Survey.organisation_id == org.id)
        .first()
    )
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")

    for det in payload.detections:
        db.add(AudioDetection(
            audio_recording_id=None,
            survey_id=survey_id,
            species_id=det.species_id,
            species_name=det.species_name,
            confidence=det.confidence,
            start_time=_parse_hms(det.start_time),
            end_time=_parse_hms(det.end_time),
            detection_timestamp=det.detection_timestamp,
        ))
    db.commit()

    return SurveyDetectionsSaveResponse(created=len(payload.detections))


def _build_recording_response(recording: AudioRecording, detection_count: int) -> dict:
    """Build response dict for an audio recording."""
    return {
        "id": recording.id,
        "survey_id": recording.survey_id,
        "filename": recording.filename,
        "r2_key": recording.r2_key,
        "file_size_bytes": recording.file_size_bytes,
        "duration_seconds": recording.duration_seconds,
        "recording_timestamp": recording.recording_timestamp,
        "processing_status": recording.processing_status.value
        if hasattr(recording.processing_status, "value")
        else recording.processing_status,
        "processing_error": recording.processing_error,
        "uploaded_at": recording.uploaded_at,
        "detection_count": detection_count,
        "unmatched_species": recording.unmatched_species,
    }


@router.get("/{survey_id}/audio", response_model=List[AudioRecordingRead])
async def list_audio_recordings(
    survey_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """List all audio recordings for a survey."""
    # Verify survey belongs to org
    survey = (
        db.query(Survey)
        .filter(Survey.id == survey_id, Survey.organisation_id == org.id)
        .first()
    )
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")

    recordings = (
        db.query(AudioRecording)
        .filter(AudioRecording.survey_id == survey_id)
        .order_by(AudioRecording.recording_timestamp.desc())  # type: ignore[union-attr]
        .all()
    )

    result = []
    for rec in recordings:
        detection_count = (
            db.query(func.count(AudioDetection.id))
            .filter(AudioDetection.audio_recording_id == rec.id)
            .scalar()
        )
        result.append(_build_recording_response(rec, detection_count))
    return result


# NOTE: must be declared before /{survey_id}/audio/{recording_id} so the
# literal segment wins over the path parameter.
@router.get("/{survey_id}/audio/processing-summary", response_model=ProcessingSummary)
async def get_audio_processing_summary(
    survey_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> ProcessingSummary:
    """Counts of audio recordings by processing status, for progress display."""
    survey = (
        db.query(Survey)
        .filter(Survey.id == survey_id, Survey.organisation_id == org.id)
        .first()
    )
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")

    rows = (
        db.query(AudioRecording.processing_status, func.count(AudioRecording.id))
        .filter(AudioRecording.survey_id == survey_id)
        .group_by(AudioRecording.processing_status)
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
    "/{survey_id}/audio",
    response_model=List[AudioRecordingRead],
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_editor)],
)
async def upload_audio_files(
    survey_id: int,
    files: List[UploadFile] = File(...),
    skip_processing: bool = Query(False, description="Skip BirdNET processing (for wizard uploads)"),
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """
    Upload one or more audio files to a survey.
    Files are stored in R2. Pending recordings are picked up by the job
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

    uploaded = []
    for file in files:
        if not file.filename.lower().endswith(".wav"):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file type: {file.filename}. Only WAV files accepted.",
            )

        # Check for duplicate
        existing = (
            db.query(AudioRecording)
            .filter(
                AudioRecording.survey_id == survey_id,
                AudioRecording.filename == file.filename,
            )
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=400, detail=f"File already exists: {file.filename}"
            )

        # Get file size before upload (upload may close the stream)
        file.file.seek(0, 2)  # Seek to end
        file_size = file.file.tell()
        file.file.seek(0)  # Reset

        # Upload to R2
        r2_key = upload_audio_file(file.file, file.filename, org.slug)

        # Create database record
        recording = AudioRecording(
            survey_id=survey_id,
            filename=file.filename,
            r2_key=r2_key,
            file_size_bytes=file_size,
            recording_timestamp=extract_media_info(file.filename).timestamp,
            processing_status=ProcessingStatus.completed if skip_processing else ProcessingStatus.pending,
        )
        db.add(recording)
        db.flush()  # Get the ID

        uploaded.append(recording)

    db.commit()

    # Build response
    return [_build_recording_response(rec, 0) for rec in uploaded]


@router.post(
    "/{survey_id}/audio/{recording_id}/process",
    dependencies=[Depends(require_editor)],
)
async def process_audio_recording(
    survey_id: int,
    recording_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """
    Manually (re)queue BirdNET processing for an audio recording.
    The job dispatcher picks it up; poll status via GET endpoint.
    """
    recording = (
        db.query(AudioRecording)
        .join(Survey)
        .filter(
            AudioRecording.id == recording_id,
            AudioRecording.survey_id == survey_id,
            Survey.organisation_id == org.id,
        )
        .first()
    )
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    if recording.processing_status == ProcessingStatus.processing:
        raise HTTPException(
            status_code=400, detail="Recording is already being processed"
        )

    # Requeue with a fresh attempt budget
    recording.processing_status = ProcessingStatus.pending
    recording.processing_attempts = 0
    recording.processing_error = None
    db.commit()

    return {"status": "queued", "message": "Processing queued"}


@router.get("/{survey_id}/audio/{recording_id}", response_model=AudioRecordingRead)
async def get_audio_recording(
    survey_id: int,
    recording_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Get details of a specific audio recording."""
    recording = (
        db.query(AudioRecording)
        .join(Survey)
        .filter(
            AudioRecording.id == recording_id,
            AudioRecording.survey_id == survey_id,
            Survey.organisation_id == org.id,
        )
        .first()
    )
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    detection_count = (
        db.query(func.count(AudioDetection.id))
        .filter(AudioDetection.audio_recording_id == recording_id)
        .scalar()
    )

    return _build_recording_response(recording, detection_count)


@router.get(
    "/{survey_id}/audio/{recording_id}/detections",
    response_model=List[AudioDetectionRead],
)
async def get_audio_detections(
    survey_id: int,
    recording_id: int,
    min_confidence: float = 0.0,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """Get bird detections for an audio recording."""
    # Verify access
    recording = (
        db.query(AudioRecording)
        .join(Survey)
        .filter(
            AudioRecording.id == recording_id,
            AudioRecording.survey_id == survey_id,
            Survey.organisation_id == org.id,
        )
        .first()
    )
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    query = db.query(AudioDetection).filter(
        AudioDetection.audio_recording_id == recording_id
    )
    if min_confidence > 0:
        query = query.filter(AudioDetection.confidence >= min_confidence)

    detections = query.order_by(AudioDetection.detection_timestamp).all()

    return [
        {
            "id": d.id,
            "species_name": d.species_name,
            "confidence": d.confidence,
            "start_time": d.start_time,
            "end_time": d.end_time,
            "detection_timestamp": d.detection_timestamp,
            "species_id": d.species_id,
            "species_common_name": None,  # Could be populated if species_id is set
        }
        for d in detections
    ]


@router.delete(
    "/{survey_id}/audio/{recording_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_editor)],
)
async def delete_audio_recording(
    survey_id: int,
    recording_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> None:
    """Delete an audio recording and its detections."""
    recording = (
        db.query(AudioRecording)
        .join(Survey)
        .filter(
            AudioRecording.id == recording_id,
            AudioRecording.survey_id == survey_id,
            Survey.organisation_id == org.id,
        )
        .first()
    )
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    # Delete from R2
    delete_audio_file(recording.r2_key)

    # Delete from database (cascades to detections)
    db.delete(recording)
    db.commit()
    return None


# Separate router for download endpoint (different path structure)
download_router = APIRouter()


@download_router.get("/{recording_id}/download")
async def get_download_url(
    recording_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Get a presigned URL to download an audio file."""
    recording = (
        db.query(AudioRecording)
        .join(Survey)
        .filter(AudioRecording.id == recording_id, Survey.organisation_id == org.id)
        .first()
    )
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    url = generate_presigned_url(recording.r2_key, expires_in=3600)
    return {"download_url": url, "expires_in": 3600}
