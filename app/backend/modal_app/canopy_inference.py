"""
Modal serverless inference for Canopy.

Three functions, reusing the backend's own service code (the `services`
package is bundled into the images):

- analyze_audio    BirdNET bird detection (CPU; TF parallelises across cores)
- classify_image   EVA02 species classification (T4 GPU)
- detect_animals   MegaDetector false positive filtering (T4 GPU)

Media arrives as a presigned R2 URL (stored media) or raw bytes (wizard
previews), so Modal needs no R2 or database credentials. Model weights are
baked into the images at build time, so cold starts skip the multi-GB
downloads. Containers scale to zero when idle — you only pay per second of
actual inference.

Deploy (from app/backend, after `pip install modal` and `modal setup`):

    modal deploy modal_app/canopy_inference.py

Then set INFERENCE_MODE=modal plus MODAL_TOKEN_ID / MODAL_TOKEN_SECRET on
the backend.
"""

from pathlib import Path

import modal

APP_NAME = "canopy-inference"

app = modal.App(APP_NAME)

# Default coordinates for location-based species filtering, matching
# services/processing.py on the backend.
DEFAULT_LAT = 51.3452
DEFAULT_LON = -2.2525


def _download_birdnet_models() -> None:
    import birdnet

    birdnet.load("acoustic", "2.4", "tf")
    birdnet.load("geo", "2.4", "tf")


def _download_vision_models() -> None:
    import timm
    from PytorchWildlife.models import detection as pw_detection

    timm.create_model(
        "hf-hub:timm/eva02_large_patch14_clip_336.merged2b_ft_inat21",
        pretrained=True,
    )
    pw_detection.MegaDetectorV6(version="MDV6-yolov9-c")


audio_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("birdnet", "requests")
    .run_function(_download_birdnet_models)
    .add_local_python_source("services")
)

vision_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1", "libglib2.0-0")
    .pip_install(
        "torch==2.4.*",
        "torchvision==0.19.*",
        "timm>=1.0.0",
        "pillow>=10.0.0",
        # <1.3: PytorchWildlife 1.3.0 eagerly imports soundfile and
        # pytorch_lightning without declaring them. lightning and omegaconf
        # are 1.2.x's own undeclared imports (mirrors requirements.txt).
        "PytorchWildlife>=1.1.0,<1.3",
        "lightning>=2.0.0",
        "omegaconf>=2.3.0",
        "numpy",
        "requests",
    )
    .run_function(_download_vision_models)
    .add_local_python_source("services")
)


def _materialise(tmpdir: str, filename: str, url: str | None, data: bytes | None) -> Path:
    """Write the media to a local file, downloading it if passed by URL."""
    import requests

    if data is None:
        if not url:
            raise ValueError("Provide a media URL or raw bytes")
        response = requests.get(url, timeout=120)
        response.raise_for_status()
        data = response.content

    # Only the name matters (timestamps are parsed from it); strip any path.
    path = Path(tmpdir) / Path(filename).name
    path.write_bytes(data)
    return path


@app.function(
    image=audio_image,
    cpu=4.0,
    memory=8192,
    timeout=1800,
    retries=modal.Retries(max_retries=2, initial_delay=10.0),
)
def analyze_audio(
    filename: str,
    audio_url: str | None = None,
    audio_bytes: bytes | None = None,
    lat: float = DEFAULT_LAT,
    lon: float = DEFAULT_LON,
) -> list[dict]:
    import tempfile

    from services.bird_audio import analyze_file, get_location_species

    with tempfile.TemporaryDirectory() as tmpdir:
        path = _materialise(tmpdir, filename, audio_url, audio_bytes)
        species_list = get_location_species(lat, lon)
        detections = analyze_file(path, species_list)

    return [
        {
            "filename": d.filename,
            "species": d.species,
            "confidence": d.confidence,
            "start_time": d.start.isoformat(),
            "end_time": d.end.isoformat(),
            "timestamp": d.timestamp.isoformat(),
        }
        for d in detections
    ]


@app.function(
    image=vision_image,
    gpu="T4",
    timeout=600,
    retries=modal.Retries(max_retries=2, initial_delay=5.0),
)
def classify_image(
    filename: str,
    image_url: str | None = None,
    image_bytes: bytes | None = None,
) -> dict:
    import tempfile

    from services.camera_trap import analyze_image, get_classifier

    if not get_classifier().load():
        raise RuntimeError("Species classification model failed to load")

    with tempfile.TemporaryDirectory() as tmpdir:
        path = _materialise(tmpdir, filename, image_url, image_bytes)
        result = analyze_image(path)

    return result.to_dict()


@app.function(
    image=vision_image,
    gpu="T4",
    timeout=600,
    retries=modal.Retries(max_retries=2, initial_delay=5.0),
)
def detect_animals(
    filename: str,
    image_url: str | None = None,
    image_bytes: bytes | None = None,
) -> dict:
    import tempfile

    from services.megadetector import get_detector

    detector = get_detector()
    if not detector.load():
        raise RuntimeError("MegaDetector model failed to load")

    with tempfile.TemporaryDirectory() as tmpdir:
        path = _materialise(tmpdir, filename, image_url, image_bytes)
        detection = detector.detect(path)

    return {
        "has_animal": detection.has_animal,
        "max_animal_confidence": detection.max_animal_confidence,
        "categories_found": detection.categories_found,
        "boxes": [
            {
                "x": b.x, "y": b.y, "w": b.w, "h": b.h,
                "confidence": b.confidence, "category": b.category,
            }
            for b in detection.boxes
        ],
    }
