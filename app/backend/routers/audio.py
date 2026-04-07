"""
Audio Recordings Router - API endpoints for bird audio analysis

Endpoints:
  POST   /api/surveys/process-audio                  - Process audio files with BirdNET (no storage)
  POST   /api/surveys/process-audio/upload           - Upload temp file to R2 for wizard processing
  POST   /api/surveys/process-audio/analyze          - Analyze a file already in R2
  POST   /api/surveys/process-audio/cleanup          - Delete temp files from R2
  GET    /api/surveys/{survey_id}/audio              - List audio recordings for survey
  POST   /api/surveys/{survey_id}/audio              - Upload audio file(s)
  GET    /api/surveys/{survey_id}/audio/{id}         - Get audio recording details
  DELETE /api/surveys/{survey_id}/audio/{id}         - Delete audio recording
  POST   /api/surveys/{survey_id}/audio/{id}/process - Trigger processing (manual)
  GET    /api/surveys/{survey_id}/audio/{id}/detections - Get detections for recording
  GET    /api/audio/{id}/download                    - Get presigned download URL
"""

import logging
import tempfile
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, List

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Body,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlmodel import col

from auth import require_admin
from database.connection import get_db, get_session_factory
from dependencies import get_current_organisation
from models import (
    AudioDetectionResult,
    AudioProcessingResponse,
    AudioRecording,
    AudioRecordingRead,
    AudioDetection,
    AudioDetectionRead,
    DetectionClip,
    Device,
    FileProcessingResult,
    Location,
    Organisation,
    ProcessingStatus,
    Species,
    SpeciesDetectionSummary,
    SpeciesType,
    Survey,
    SurveyDetectionsSummaryResponse,
)
from services.r2_storage import (
    delete_audio_file,
    delete_media_files,
    download_audio_file,
    generate_presigned_url,
    upload_audio_file,
    upload_media_file,
    download_media_file,
    MediaType,
)
from utils.filename_parser import extract_media_info

logger = logging.getLogger(__name__)

router = APIRouter()

# Default coordinates for location-based species filtering (used by background processing)
DEFAULT_LAT = 51.3452
DEFAULT_LON = -2.2525


def extract_recording_info(filename: str) -> dict:
    """Extract device serial and timestamp from filename."""
    info = extract_media_info(filename)
    return {"device_serial": info.device_serial, "recording_timestamp": info.timestamp}


@router.post(
    "/process-audio",
    response_model=AudioProcessingResponse,
    dependencies=[Depends(require_admin)],
)
async def process_audio_files(
    files: List[UploadFile] = File(...),
    lat: float = Query(DEFAULT_LAT, description="Latitude for location-based species filtering"),
    lon: float = Query(DEFAULT_LON, description="Longitude for location-based species filtering"),
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> AudioProcessingResponse:
    """
    Process audio files with BirdNET and return detections.
    Files are NOT stored — this is for the audio wizard preview.
    """
    from services.bird_audio import analyze_file, get_db_scientific_name, get_location_species

    # Get location-filtered species list
    species_list = get_location_species(lat, lon)

    results = []
    for file in files:
        if not file.filename or not file.filename.lower().endswith(".wav"):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file type: {file.filename}. Only WAV files accepted.",
            )

        with tempfile.TemporaryDirectory() as tmpdir:
            local_path = Path(tmpdir) / file.filename
            content = await file.read()
            local_path.write_bytes(content)

            try:
                detections = analyze_file(local_path, species_list)
            except Exception as e:
                logger.exception(f"Error processing {file.filename}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to process {file.filename}: {str(e)}",
                )

            file_detections = []
            unmatched = []
            for det in detections:
                scientific_name = get_db_scientific_name(det.species)
                species = (
                    db.query(Species)
                    .join(Species.species_type)
                    .filter(
                        Species.scientific_name == scientific_name,
                        SpeciesType.name == "bird",
                    )
                    .first()
                )

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
                        )
                    )
                else:
                    if det.species not in unmatched:
                        unmatched.append(det.species)

            results.append(
                FileProcessingResult(
                    filename=file.filename,
                    detections=file_detections,
                    unmatched_species=unmatched,
                )
            )

    return AudioProcessingResponse(results=results)


# ============================================================================
# Decoupled wizard endpoints: upload → analyze → cleanup
# ============================================================================


class TempUploadResponse(BaseModel):
    r2_key: str
    filename: str


@router.post(
    "/process-audio/upload",
    response_model=TempUploadResponse,
    dependencies=[Depends(require_admin)],
)
async def upload_temp_audio(
    file: UploadFile = File(...),
    org: Organisation = Depends(get_current_organisation),
) -> TempUploadResponse:
    """
    Upload a single audio file to R2 temporary storage for wizard processing.
    Files are stored under temp-audio/{org_slug}/{uuid}/ and should be cleaned up after use.
    """
    if not file.filename or not file.filename.lower().endswith(".wav"):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type: {file.filename}. Only WAV files accepted.",
        )

    session_id = uuid.uuid4().hex[:12]
    temp_filename = f"{session_id}_{file.filename}"
    r2_key = f"temp-audio/{org.slug}/{temp_filename}"

    from services.r2_storage import get_r2_client
    from config import settings

    client = get_r2_client()
    client.upload_fileobj(
        file.file,
        settings.r2_bucket_name,
        r2_key,
        ExtraArgs={"ContentType": "audio/wav"},
    )

    return TempUploadResponse(r2_key=r2_key, filename=file.filename)


class AnalyzeRequest(BaseModel):
    r2_key: str
    filename: str
    lat: float = DEFAULT_LAT
    lon: float = DEFAULT_LON


@router.post(
    "/process-audio/analyze",
    response_model=FileProcessingResult,
    dependencies=[Depends(require_admin)],
)
async def analyze_temp_audio(
    request: AnalyzeRequest,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> FileProcessingResult:
    """
    Analyze an audio file already uploaded to R2 with BirdNET.
    Downloads from R2, processes, and returns detections. File remains in R2.
    """
    from services.bird_audio import analyze_file, get_db_scientific_name, get_location_species

    # Validate the r2_key belongs to this org's temp space
    expected_prefix = f"temp-audio/{org.slug}/"
    if not request.r2_key.startswith(expected_prefix):
        raise HTTPException(status_code=403, detail="Access denied to this file")

    species_list = get_location_species(request.lat, request.lon)

    with tempfile.TemporaryDirectory() as tmpdir:
        local_path = Path(tmpdir) / request.filename
        try:
            download_media_file(request.r2_key, local_path)
        except Exception as e:
            logger.exception(f"Failed to download {request.r2_key} from R2")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to download file from storage: {str(e)}",
            )

        try:
            detections = analyze_file(local_path, species_list)
        except Exception as e:
            logger.exception(f"Error processing {request.filename}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to process {request.filename}: {str(e)}",
            )

        file_detections = []
        unmatched = []
        for det in detections:
            scientific_name = get_db_scientific_name(det.species)
            species = (
                db.query(Species)
                .join(Species.species_type)
                .filter(
                    Species.scientific_name == scientific_name,
                    SpeciesType.name == "bird",
                )
                .first()
            )

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
                    )
                )
            else:
                if det.species not in unmatched:
                    unmatched.append(det.species)

    return FileProcessingResult(
        filename=request.filename,
        detections=file_detections,
        unmatched_species=unmatched,
    )


class CleanupRequest(BaseModel):
    r2_keys: list[str]


@router.post(
    "/process-audio/cleanup",
    dependencies=[Depends(require_admin)],
)
async def cleanup_temp_audio(
    request: CleanupRequest,
    org: Organisation = Depends(get_current_organisation),
) -> dict[str, int]:
    """
    Delete temporary audio files from R2 after wizard processing is complete.
    Only deletes files within the org's temp-audio prefix.
    """
    expected_prefix = f"temp-audio/{org.slug}/"
    valid_keys = [k for k in request.r2_keys if k.startswith(expected_prefix)]

    if not valid_keys:
        return {"deleted": 0}

    deleted = delete_media_files(valid_keys)
    return {"deleted": deleted}


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
        "device_serial": recording.device_serial,
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


@router.post(
    "/{survey_id}/audio",
    response_model=List[AudioRecordingRead],
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
async def upload_audio_files(
    survey_id: int,
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    skip_processing: bool = Query(False, description="Skip BirdNET processing (for wizard uploads)"),
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """
    Upload one or more audio files to a survey.
    Files are stored in R2. Processing is auto-triggered unless skip_processing=true.
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

        # Extract metadata from filename
        info = extract_recording_info(file.filename)

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
            device_serial=info["device_serial"],
            recording_timestamp=info["recording_timestamp"],
            processing_status=ProcessingStatus.completed if skip_processing else ProcessingStatus.pending,
        )
        db.add(recording)
        db.flush()  # Get the ID

        uploaded.append(recording)

        # Auto-trigger background processing (unless skipped for wizard uploads)
        if not skip_processing:
            background_tasks.add_task(process_recording_background, recording_id=recording.id)

    db.commit()

    # Build response
    return [_build_recording_response(rec, 0) for rec in uploaded]


@router.post(
    "/{survey_id}/audio/{recording_id}/process",
    dependencies=[Depends(require_admin)],
)
async def process_audio_recording(
    survey_id: int,
    recording_id: int,
    background_tasks: BackgroundTasks,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """
    Manually trigger BirdNET processing for an audio recording.
    Processing runs in background; poll status via GET endpoint.
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

    # Mark as processing
    recording.processing_status = ProcessingStatus.processing
    recording.processing_started_at = datetime.utcnow()
    recording.processing_error = None
    db.commit()

    # Queue background processing
    background_tasks.add_task(process_recording_background, recording_id=recording_id)

    return {"status": "processing", "message": "Processing started"}


def process_recording_background(recording_id: int) -> None:
    """Background task to process audio with BirdNET."""
    from services.bird_audio import analyze_file, get_db_scientific_name, get_location_species

    SessionLocal = get_session_factory()
    db = SessionLocal()

    try:
        recording = (
            db.query(AudioRecording)
            .filter(AudioRecording.id == recording_id)
            .first()
        )
        if not recording:
            logger.error(f"Recording {recording_id} not found for processing")
            return

        # Update status to processing
        recording.processing_status = ProcessingStatus.processing
        recording.processing_started_at = datetime.utcnow()
        db.commit()

        # Download file to temp location
        with tempfile.TemporaryDirectory() as tmpdir:
            local_path = Path(tmpdir) / recording.filename
            download_audio_file(recording.r2_key, local_path)

            # Get location-filtered species list
            species_list = get_location_species(DEFAULT_LAT, DEFAULT_LON)

            # Run BirdNET analysis
            detections = analyze_file(local_path, species_list)

            # Store detections, tracking unmatched species
            unmatched = []
            matched_count = 0
            for det in detections:
                # Look up species in database
                scientific_name = get_db_scientific_name(det.species)
                species = db.query(Species).join(
                    Species.species_type
                ).filter(
                    Species.scientific_name == scientific_name,
                    SpeciesType.name == "bird"
                ).first()

                if species:
                    audio_det = AudioDetection(
                        audio_recording_id=recording_id,
                        species_name=det.species,
                        species_id=species.id,
                        confidence=det.confidence,
                        start_time=det.start,
                        end_time=det.end,
                        detection_timestamp=det.timestamp,
                    )
                    db.add(audio_det)
                    matched_count += 1
                else:
                    # Track unmatched species (avoid duplicates)
                    if det.species not in unmatched:
                        unmatched.append(det.species)

            # Store unmatched species on the recording
            recording.unmatched_species = unmatched if unmatched else None

            # Update recording status
            recording.processing_status = ProcessingStatus.completed
            recording.processing_completed_at = datetime.utcnow()
            db.commit()

            logger.info(
                f"Processed recording {recording_id}: {matched_count} matched detections, "
                f"{len(unmatched)} unmatched species"
            )

    except Exception as e:
        logger.exception(f"Error processing recording {recording_id}")
        try:
            recording = (
                db.query(AudioRecording)
                .filter(AudioRecording.id == recording_id)
                .first()
            )
            if recording:
                recording.processing_status = ProcessingStatus.failed
                recording.processing_error = str(e)
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


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


@router.get(
    "/{survey_id}/detections/summary",
    response_model=SurveyDetectionsSummaryResponse,
)
async def get_detections_summary(
    survey_id: int,
    org: Organisation = Depends(get_current_organisation),
    db: Session = Depends(get_db),
) -> SurveyDetectionsSummaryResponse:
    """
    Get aggregated detection summary for a survey, grouped by species.
    Returns top 3 detections per species sorted by confidence.
    """
    # Verify survey belongs to org
    survey = (
        db.query(Survey)
        .filter(Survey.id == survey_id, Survey.organisation_id == org.id)
        .first()
    )
    if not survey:
        raise HTTPException(status_code=404, detail="Survey not found")

    # Get all audio recordings for this survey with device_serial
    recordings = (
        db.query(AudioRecording.id, AudioRecording.device_serial)
        .filter(AudioRecording.survey_id == survey_id)
        .all()
    )
    recording_ids = [r[0] for r in recordings]

    if not recording_ids:
        return SurveyDetectionsSummaryResponse(species_summaries=[])

    # Build mapping from device_serial to device info
    device_serials = set(r.device_serial for r in recordings if r.device_serial)
    device_map = {}
    if device_serials:
        # Query devices with coordinates extracted from PostGIS point_geometry
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

    # Build mapping from audio_recording_id to device info
    recording_device_map = {}
    for rec in recordings:
        if rec.device_serial and rec.device_serial in device_map:
            recording_device_map[rec.id] = device_map[rec.device_serial]

    # Get all detections grouped by (species, device) with counts
    # This ensures each device's detections are counted separately
    from sqlalchemy import desc

    # Build reverse mapping: recording_id -> device_serial
    recording_to_device = {r.id: r.device_serial for r in recordings}

    # Get unique (species, device) combinations with their detection counts
    # We need to join through AudioRecording to get device_serial
    species_device_counts = (
        db.query(
            AudioDetection.species_id,
            Species.name.label("species_name"),  # type: ignore[union-attr]
            Species.scientific_name.label("species_scientific_name"),  # type: ignore[union-attr]
            AudioRecording.device_serial,
            func.count(AudioDetection.id).label("detection_count"),
            func.max(AudioDetection.confidence).label("max_confidence"),
        )
        .join(Species, AudioDetection.species_id == Species.id)
        .join(AudioRecording, AudioDetection.audio_recording_id == AudioRecording.id)
        .filter(col(AudioDetection.audio_recording_id).in_(recording_ids))
        .group_by(
            AudioDetection.species_id,
            Species.name,
            Species.scientific_name,
            AudioRecording.device_serial,
        )
        .order_by(desc("max_confidence"))
        .all()
    )

    summaries = []
    for row in species_device_counts:
        device_serial = row.device_serial
        device_info = device_map.get(device_serial, {})

        # Get recording IDs for this specific device
        device_recording_ids = [
            r.id for r in recordings if r.device_serial == device_serial
        ]

        # Get top 3 detections for this species FROM THIS DEVICE ONLY
        top_detections = (
            db.query(AudioDetection)
            .filter(
                col(AudioDetection.audio_recording_id).in_(device_recording_ids),
                AudioDetection.species_id == row.species_id,
            )
            .order_by(desc(AudioDetection.confidence))
            .limit(3)
            .all()
        )

        clips = []
        for det in top_detections:
            clips.append(
                DetectionClip(
                    confidence=det.confidence,
                    audio_recording_id=det.audio_recording_id,
                    start_time=det.start_time,
                    end_time=det.end_time,
                    device_id=device_info.get("device_id"),
                    device_name=device_info.get("device_name"),
                    device_latitude=device_info.get("device_latitude"),
                    device_longitude=device_info.get("device_longitude"),
                    location_id=device_info.get("location_id"),
                    location_name=device_info.get("location_name"),
                )
            )

        summaries.append(
            SpeciesDetectionSummary(
                species_id=row.species_id,
                species_name=row.species_name,
                species_scientific_name=row.species_scientific_name,
                detection_count=row.detection_count,
                top_detections=clips,
            )
        )

    return SurveyDetectionsSummaryResponse(species_summaries=summaries)


@router.delete(
    "/{survey_id}/audio/{recording_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin)],
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
