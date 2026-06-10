"""Tests for the inference dispatch layer (services/inference.py)."""

from datetime import datetime, time

import pytest

from config import settings
import services.inference as inference
from services.inference import (
    InferenceError,
    analyze_audio_bytes,
    analyze_audio_recording,
    classify_camera_trap_image,
    detect_animals_bytes,
)


class FakeModalFunction:
    """Stands in for a deployed Modal function handle."""

    def __init__(self, result):
        self.result = result
        self.calls: list[dict] = []

    def remote(self, **kwargs):
        self.calls.append(kwargs)
        return self.result


@pytest.fixture
def modal_mode(monkeypatch):
    """Switch the dispatch layer to modal and capture remote calls."""
    monkeypatch.setattr(settings, "inference_mode", "modal")

    functions: dict[str, FakeModalFunction] = {}

    def fake_lookup(name: str) -> FakeModalFunction:
        return functions[name]

    monkeypatch.setattr(inference, "_modal_function", fake_lookup)
    monkeypatch.setattr(
        inference, "generate_media_presigned_url",
        lambda r2_key, expires_in=3600: f"https://r2.example/{r2_key}?signed",
    )
    return functions


class TestLocalMode:
    def test_analyze_audio_bytes_runs_local_model(self, monkeypatch):
        import services.bird_audio as bird_audio

        seen = {}

        def fake_analyze(path, species_list):
            seen["path_name"] = path.name
            seen["content"] = path.read_bytes()
            seen["species_list"] = species_list
            return ["sentinel"]

        monkeypatch.setattr(bird_audio, "analyze_file", fake_analyze)
        monkeypatch.setattr(bird_audio, "get_location_species", lambda lat, lon: ["x"])

        result = analyze_audio_bytes(b"wav-bytes", "DEV_20260101_120000.wav", 51.0, -2.0)

        assert result == ["sentinel"]
        assert seen["path_name"] == "DEV_20260101_120000.wav"
        assert seen["content"] == b"wav-bytes"
        assert seen["species_list"] == ["x"]

    def test_detect_animals_bytes_raises_when_model_unavailable(self, monkeypatch):
        import services.megadetector as megadetector

        class FailingDetector:
            def load(self):
                return False

        monkeypatch.setattr(megadetector, "get_detector", lambda: FailingDetector())

        with pytest.raises(InferenceError):
            detect_animals_bytes(b"jpg-bytes", "a.jpg")


class TestModalMode:
    def test_audio_recording_sends_presigned_url_and_converts(self, modal_mode):
        modal_mode["analyze_audio"] = FakeModalFunction([
            {
                "filename": "DEV_20260101_120000.wav",
                "species": "Turdus merula_Eurasian Blackbird",
                "confidence": 0.91,
                "start_time": "00:00:03",
                "end_time": "00:00:06",
                "timestamp": "2026-01-01T12:00:03",
            }
        ])

        detections = analyze_audio_recording(
            "audio/org/rec.wav", "DEV_20260101_120000.wav", 51.0, -2.0
        )

        call = modal_mode["analyze_audio"].calls[0]
        assert call["audio_url"] == "https://r2.example/audio/org/rec.wav?signed"
        assert call["filename"] == "DEV_20260101_120000.wav"
        assert call["lat"] == 51.0

        (det,) = detections
        assert det.species == "Turdus merula_Eurasian Blackbird"
        assert det.confidence == 0.91
        assert det.start == time(0, 0, 3)
        assert det.end == time(0, 0, 6)
        assert det.timestamp == datetime(2026, 1, 1, 12, 0, 3)

    def test_audio_bytes_sends_bytes(self, modal_mode):
        modal_mode["analyze_audio"] = FakeModalFunction([])

        detections = analyze_audio_bytes(b"wav-bytes", "a.wav", 51.0, -2.0)

        assert detections == []
        call = modal_mode["analyze_audio"].calls[0]
        assert call["audio_bytes"] == b"wav-bytes"
        assert "audio_url" not in call

    def test_classify_image_converts_result(self, modal_mode):
        modal_mode["classify_image"] = FakeModalFunction({
            "classification": {
                "scientific_name": "Vulpes vulpes",
                "common_name": "Red Fox",
                "confidence": 0.88,
                "taxonomic_level": "species",
                "taxonomy": {},
            },
            "timestamp": "2026-01-01T20:15:00",
            "flagged_for_review": True,
            "review_reason": "Low confidence (88.0%)",
            "top_predictions": [
                {"scientific_name": "Vulpes vulpes", "common_name": "Red Fox", "confidence": 0.88},
            ],
        })

        result = classify_camera_trap_image("images/org/img.jpg", "img.jpg")

        call = modal_mode["classify_image"].calls[0]
        assert call["image_url"] == "https://r2.example/images/org/img.jpg?signed"

        assert result.classification is not None
        assert result.classification.scientific_name == "Vulpes vulpes"
        assert result.classification.confidence == 0.88
        assert result.flagged_for_review is True
        assert result.review_reason == "Low confidence (88.0%)"
        assert result.timestamp == datetime(2026, 1, 1, 20, 15)
        assert len(result.top_predictions) == 1

    def test_classify_image_handles_no_classification(self, modal_mode):
        modal_mode["classify_image"] = FakeModalFunction({
            "classification": None,
            "timestamp": None,
            "flagged_for_review": False,
            "review_reason": None,
            "top_predictions": [],
        })

        result = classify_camera_trap_image("images/org/img.jpg", "img.jpg")

        assert result.classification is None
        assert result.flagged_for_review is False

    def test_detect_animals_converts_result(self, modal_mode):
        modal_mode["detect_animals"] = FakeModalFunction({
            "has_animal": True,
            "max_animal_confidence": 0.72,
            "categories_found": ["animal"],
            "boxes": [
                {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4, "confidence": 0.72, "category": "animal"},
            ],
        })

        detection = detect_animals_bytes(b"jpg-bytes", "img.jpg")

        call = modal_mode["detect_animals"].calls[0]
        assert call["image_bytes"] == b"jpg-bytes"

        assert detection.has_animal is True
        assert detection.max_animal_confidence == 0.72
        assert detection.categories_found == ["animal"]
        (box,) = detection.boxes
        assert (box.x, box.y, box.w, box.h) == (0.1, 0.2, 0.3, 0.4)
        assert box.category == "animal"


class TestJobConcurrencyDefaults:
    def test_local_default(self, monkeypatch):
        monkeypatch.setattr(settings, "inference_mode", "local")
        monkeypatch.setattr(settings, "job_concurrency", None)
        assert settings.effective_job_concurrency == 2

    def test_modal_default(self, monkeypatch):
        monkeypatch.setattr(settings, "inference_mode", "modal")
        monkeypatch.setattr(settings, "job_concurrency", None)
        assert settings.effective_job_concurrency == 16

    def test_explicit_override_wins(self, monkeypatch):
        monkeypatch.setattr(settings, "inference_mode", "modal")
        monkeypatch.setattr(settings, "job_concurrency", 4)
        assert settings.effective_job_concurrency == 4
