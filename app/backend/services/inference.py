"""
Inference dispatch: run model inference in-process or on Modal serverless
functions, controlled by INFERENCE_MODE ('local' | 'modal').

In modal mode the backend does no heavy compute and never imports the model
libraries: stored media is passed to Modal by presigned R2 URL, wizard
uploads as raw bytes, and results come back as plain dicts which are
converted to the same dataclasses the local services return, so callers
cannot tell the difference.
"""

import logging
import tempfile
from datetime import datetime, time
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING, Any

from config import settings
from services.r2_storage import download_media_file, generate_media_presigned_url

if TYPE_CHECKING:
    from services.bird_audio import Detection
    from services.camera_trap import ImageResult
    from services.megadetector import DetectionResult

logger = logging.getLogger(__name__)


class InferenceError(RuntimeError):
    """Raised when an inference backend is unavailable or fails to load."""


def _use_modal() -> bool:
    return settings.inference_mode.lower() == "modal"


@lru_cache(maxsize=8)
def _modal_function(name: str) -> Any:
    import modal

    return modal.Function.from_name(settings.modal_app_name, name)


# ============================================================================
# Audio (BirdNET)
# ============================================================================

def analyze_audio_recording(
    r2_key: str, filename: str, lat: float, lon: float
) -> list["Detection"]:
    """Analyse a stored audio recording, returning BirdNET detections."""
    if _use_modal():
        url = generate_media_presigned_url(r2_key, expires_in=3600)
        raw = _modal_function("analyze_audio").remote(
            filename=filename, audio_url=url, lat=lat, lon=lon
        )
        return _audio_detections_from_dicts(raw)

    from services.bird_audio import analyze_file, get_location_species

    with tempfile.TemporaryDirectory() as tmpdir:
        local_path = Path(tmpdir) / filename
        download_media_file(r2_key, local_path)
        return analyze_file(local_path, get_location_species(lat, lon))


def analyze_audio_bytes(
    content: bytes, filename: str, lat: float, lon: float
) -> list["Detection"]:
    """Analyse audio passed as bytes (wizard previews; nothing is stored)."""
    if _use_modal():
        raw = _modal_function("analyze_audio").remote(
            filename=filename, audio_bytes=content, lat=lat, lon=lon
        )
        return _audio_detections_from_dicts(raw)

    from services.bird_audio import analyze_file, get_location_species

    with tempfile.TemporaryDirectory() as tmpdir:
        local_path = Path(tmpdir) / filename
        local_path.write_bytes(content)
        return analyze_file(local_path, get_location_species(lat, lon))


def _audio_detections_from_dicts(raw: list[dict]) -> list["Detection"]:
    from services.bird_audio import Detection

    return [
        Detection(
            filename=r["filename"],
            start=time.fromisoformat(r["start_time"]),
            end=time.fromisoformat(r["end_time"]),
            species=r["species"],
            confidence=r["confidence"],
            timestamp=datetime.fromisoformat(r["timestamp"]),
        )
        for r in raw
    ]


# ============================================================================
# Camera trap classification (EVA02)
# ============================================================================

def classify_camera_trap_image(r2_key: str, filename: str) -> "ImageResult":
    """Classify a stored camera trap image, returning the species result."""
    if _use_modal():
        url = generate_media_presigned_url(r2_key, expires_in=3600)
        raw = _modal_function("classify_image").remote(filename=filename, image_url=url)
        return _image_result_from_dict(raw, filename)

    from services.camera_trap import analyze_image, get_classifier

    if not get_classifier().load():
        raise InferenceError("Species classification model failed to load")

    with tempfile.TemporaryDirectory() as tmpdir:
        local_path = Path(tmpdir) / filename
        download_media_file(r2_key, local_path)
        return analyze_image(local_path)


def _image_result_from_dict(raw: dict, filename: str) -> "ImageResult":
    from services.camera_trap import Classification, ImageResult

    classification = None
    if raw.get("classification"):
        c = raw["classification"]
        classification = Classification(
            scientific_name=c["scientific_name"],
            common_name=c["common_name"],
            confidence=c["confidence"],
            taxonomic_level=c["taxonomic_level"],
            taxonomy=c.get("taxonomy") or {},
        )

    timestamp = None
    if raw.get("timestamp"):
        timestamp = datetime.fromisoformat(raw["timestamp"])

    return ImageResult(
        filepath=filename,
        timestamp=timestamp,
        classification=classification,
        flagged_for_review=raw["flagged_for_review"],
        review_reason=raw.get("review_reason"),
        top_predictions=raw.get("top_predictions") or [],
    )


# ============================================================================
# MegaDetector false positive filtering
# ============================================================================

def detect_animals_bytes(content: bytes, filename: str) -> "DetectionResult":
    """Run MegaDetector on image bytes (filter wizard; nothing is stored)."""
    if _use_modal():
        raw = _modal_function("detect_animals").remote(
            filename=filename, image_bytes=content
        )
        return _detection_result_from_dict(raw)

    from services.megadetector import get_detector

    detector = get_detector()
    if not detector.load():
        raise InferenceError("MegaDetector model failed to load")

    with tempfile.TemporaryDirectory() as tmpdir:
        local_path = Path(tmpdir) / filename
        local_path.write_bytes(content)
        return detector.detect(local_path)


def _detection_result_from_dict(raw: dict) -> "DetectionResult":
    from services.megadetector import BoundingBox, DetectionResult

    return DetectionResult(
        has_animal=raw["has_animal"],
        max_animal_confidence=raw["max_animal_confidence"],
        categories_found=raw.get("categories_found") or [],
        boxes=[
            BoundingBox(
                x=b["x"], y=b["y"], w=b["w"], h=b["h"],
                confidence=b["confidence"], category=b["category"],
            )
            for b in raw.get("boxes") or []
        ],
    )
