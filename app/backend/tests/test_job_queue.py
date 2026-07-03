"""
Tests for the durable media job queue and processing endpoints.

The dispatcher opens its own DB sessions, so these tests commit fixture data
for real (with cleanup) instead of relying on the transaction-rollback
isolation used elsewhere.
"""

import asyncio
from datetime import date, datetime, time, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from database.connection import get_session_factory
from models import (
    AudioRecording,
    CameraTrapImage,
    Organisation,
    ProcessingStatus,
    Survey,
)
from services.job_queue import JOB_KINDS, JobDispatcher, JobKind

AUDIO_KIND = next(k for k in JOB_KINDS if k.name == "audio")
IMAGE_KIND = next(k for k in JOB_KINDS if k.name == "image")


def make_dispatcher(**overrides) -> JobDispatcher:
    defaults = {"concurrency": 2, "poll_interval": 0.01, "max_attempts": 3, "job_timeout": 60}
    defaults.update(overrides)
    return JobDispatcher(**defaults)


def add_recording(db: Session, survey_id: int, **kwargs) -> AudioRecording:
    rec = AudioRecording(
        survey_id=survey_id,
        filename=kwargs.pop("filename", f"rec_{uuid4().hex}.wav"),
        r2_key=f"audio/test/{uuid4().hex}.wav",
        **kwargs,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


def add_image(db: Session, survey_id: int, **kwargs) -> CameraTrapImage:
    img = CameraTrapImage(
        survey_id=survey_id,
        filename=kwargs.pop("filename", f"img_{uuid4().hex}.jpg"),
        r2_key=f"images/test/{uuid4().hex}.jpg",
        **kwargs,
    )
    db.add(img)
    db.commit()
    db.refresh(img)
    return img


@pytest.fixture
def committed_survey():
    """Organisation + survey committed for real, cleaned up afterwards."""
    SessionLocal = get_session_factory()
    db = SessionLocal()

    # Remove leftovers from a previously crashed run
    stale = db.query(Organisation).filter(Organisation.slug == "jobq-test-org").first()
    if stale:
        for survey in db.query(Survey).filter(Survey.organisation_id == stale.id).all():
            db.delete(survey)
        db.delete(stale)
        db.commit()

    org = Organisation(
        name="JobQ Test Org", slug="jobq-test-org",
        admin_password="x", is_active=True,
    )
    db.add(org)
    db.commit()
    db.refresh(org)
    survey = Survey(date=date(2026, 1, 1), organisation_id=org.id)
    db.add(survey)
    db.commit()
    db.refresh(survey)

    yield db, survey

    db.rollback()
    db.delete(survey)  # cascades to media rows and their detections
    db.delete(org)
    db.commit()
    db.close()


class TestClaim:
    def test_claim_marks_row_processing_and_counts_attempt(self, committed_survey):
        db, survey = committed_survey
        rec = add_recording(db, survey.id)

        claimed = make_dispatcher().claim(AUDIO_KIND, 10)

        assert rec.id in claimed
        db.expire_all()
        assert rec.processing_status == ProcessingStatus.processing
        assert rec.processing_attempts == 1
        assert rec.processing_started_at is not None

    def test_claim_ignores_non_pending_rows(self, committed_survey):
        db, survey = committed_survey
        done = add_recording(db, survey.id, processing_status=ProcessingStatus.completed)
        failed = add_recording(db, survey.id, processing_status=ProcessingStatus.failed)

        claimed = make_dispatcher().claim(AUDIO_KIND, 10)

        assert done.id not in claimed
        assert failed.id not in claimed

    def test_claim_respects_limit(self, committed_survey):
        db, survey = committed_survey
        for _ in range(3):
            add_recording(db, survey.id)

        claimed = make_dispatcher().claim(AUDIO_KIND, 2)

        assert len(claimed) == 2

    def test_claim_images(self, committed_survey):
        db, survey = committed_survey
        img = add_image(db, survey.id)

        claimed = make_dispatcher().claim(IMAGE_KIND, 10)

        assert img.id in claimed
        db.expire_all()
        assert img.processing_status == ProcessingStatus.processing


class TestFailureHandling:
    def test_failure_requeues_until_out_of_attempts(self, committed_survey):
        db, survey = committed_survey
        rec = add_recording(db, survey.id)
        dispatcher = make_dispatcher(max_attempts=3)
        dispatcher.claim(AUDIO_KIND, 10)

        dispatcher.record_failure(AUDIO_KIND, rec.id, "boom")

        db.expire_all()
        assert rec.processing_status == ProcessingStatus.pending
        assert rec.processing_error == "boom"

    def test_failure_marks_failed_at_max_attempts(self, committed_survey):
        db, survey = committed_survey
        rec = add_recording(
            db, survey.id,
            processing_status=ProcessingStatus.processing,
            processing_attempts=3,
        )

        make_dispatcher(max_attempts=3).record_failure(AUDIO_KIND, rec.id, "boom")

        db.expire_all()
        assert rec.processing_status == ProcessingStatus.failed
        assert rec.processing_error == "boom"

    def test_run_job_records_exception(self, committed_survey):
        db, survey = committed_survey
        rec = add_recording(db, survey.id)
        dispatcher = make_dispatcher()
        dispatcher.claim(AUDIO_KIND, 10)

        def boom(row_id: int) -> None:
            raise RuntimeError("kaboom")

        kind = JobKind("audio", "audio_recording", boom)
        asyncio.run(dispatcher._run_job(kind, rec.id))

        db.expire_all()
        assert rec.processing_status == ProcessingStatus.pending
        assert "kaboom" in rec.processing_error

    def test_run_job_times_out(self, committed_survey):
        db, survey = committed_survey
        rec = add_recording(db, survey.id)
        dispatcher = make_dispatcher(job_timeout=1)
        dispatcher.claim(AUDIO_KIND, 10)

        def slow(row_id: int) -> None:
            import time as time_module
            time_module.sleep(2)

        kind = JobKind("audio", "audio_recording", slow)
        asyncio.run(dispatcher._run_job(kind, rec.id))

        db.expire_all()
        assert rec.processing_status == ProcessingStatus.pending
        assert "Timed out" in rec.processing_error


class TestStaleSweep:
    def test_sweep_requeues_stale_processing_rows(self, committed_survey):
        db, survey = committed_survey
        stale_time = datetime.utcnow() - timedelta(days=1)
        rec = add_recording(
            db, survey.id,
            processing_status=ProcessingStatus.processing,
            processing_started_at=stale_time,
            processing_attempts=1,
        )

        make_dispatcher(job_timeout=60).sweep_stale()

        db.expire_all()
        assert rec.processing_status == ProcessingStatus.pending

    def test_sweep_fails_stale_rows_out_of_attempts(self, committed_survey):
        db, survey = committed_survey
        stale_time = datetime.utcnow() - timedelta(days=1)
        rec = add_recording(
            db, survey.id,
            processing_status=ProcessingStatus.processing,
            processing_started_at=stale_time,
            processing_attempts=3,
        )

        make_dispatcher(job_timeout=60, max_attempts=3).sweep_stale()

        db.expire_all()
        assert rec.processing_status == ProcessingStatus.failed
        assert rec.processing_error is not None

    def test_sweep_leaves_fresh_processing_rows(self, committed_survey):
        db, survey = committed_survey
        rec = add_recording(
            db, survey.id,
            processing_status=ProcessingStatus.processing,
            processing_started_at=datetime.utcnow(),
            processing_attempts=1,
        )

        make_dispatcher(job_timeout=60).sweep_stale()

        db.expire_all()
        assert rec.processing_status == ProcessingStatus.processing


class TestProcessingJobs:
    def test_process_audio_recording_completes_and_is_idempotent(
        self, committed_survey, monkeypatch
    ):
        db, survey = committed_survey
        rec = add_recording(db, survey.id, filename="DEV1_20260101_120000.wav")

        import services.processing as processing
        from services.bird_audio import Detection

        fake_detection = Detection(
            filename=rec.filename,
            start=time(0, 0, 1),
            end=time(0, 0, 4),
            species="Imaginarius birdus_Imaginary Bird",
            confidence=0.93,
            timestamp=datetime(2026, 1, 1, 12, 0, 1),
        )
        monkeypatch.setattr(
            processing, "analyze_audio_recording",
            lambda r2_key, filename, lat, lon: [fake_detection],
        )

        processing.process_audio_recording(rec.id)
        processing.process_audio_recording(rec.id)  # idempotent on retry

        db.expire_all()
        assert rec.processing_status == ProcessingStatus.completed
        assert rec.processing_completed_at is not None
        # Species is not in the DB, so it lands in unmatched (exactly once)
        assert rec.unmatched_species == ["Imaginarius birdus_Imaginary Bird"]


class TestRequeueEndpoints:
    def test_process_endpoint_requeues_failed_recording(
        self, client: TestClient, db_session: Session, auth_headers: dict, create_survey
    ):
        survey = create_survey()
        rec = AudioRecording(
            survey_id=survey.id,
            filename="a.wav",
            r2_key=f"audio/test/{uuid4().hex}.wav",
            processing_status=ProcessingStatus.failed,
            processing_attempts=3,
            processing_error="old error",
        )
        db_session.add(rec)
        db_session.commit()
        db_session.refresh(rec)

        response = client.post(
            f"/api/surveys/{survey.id}/audio/{rec.id}/process", headers=auth_headers
        )

        assert response.status_code == 200
        assert response.json()["status"] == "queued"
        db_session.expire_all()
        assert rec.processing_status == ProcessingStatus.pending
        assert rec.processing_attempts == 0
        assert rec.processing_error is None

    def test_process_endpoint_rejects_in_flight_recording(
        self, client: TestClient, db_session: Session, auth_headers: dict, create_survey
    ):
        survey = create_survey()
        rec = AudioRecording(
            survey_id=survey.id,
            filename="b.wav",
            r2_key=f"audio/test/{uuid4().hex}.wav",
            processing_status=ProcessingStatus.processing,
        )
        db_session.add(rec)
        db_session.commit()
        db_session.refresh(rec)

        response = client.post(
            f"/api/surveys/{survey.id}/audio/{rec.id}/process", headers=auth_headers
        )

        assert response.status_code == 400

    def test_process_endpoint_requeues_failed_image(
        self, client: TestClient, db_session: Session, auth_headers: dict, create_survey
    ):
        survey = create_survey()
        img = CameraTrapImage(
            survey_id=survey.id,
            filename="a.jpg",
            r2_key=f"images/test/{uuid4().hex}.jpg",
            processing_status=ProcessingStatus.failed,
            processing_attempts=2,
            processing_error="old error",
        )
        db_session.add(img)
        db_session.commit()
        db_session.refresh(img)

        response = client.post(
            f"/api/surveys/{survey.id}/images/{img.id}/process", headers=auth_headers
        )

        assert response.status_code == 200
        assert response.json()["status"] == "queued"
        db_session.expire_all()
        assert img.processing_status == ProcessingStatus.pending
        assert img.processing_attempts == 0
        assert img.processing_error is None


class TestProcessingSummary:
    def test_audio_processing_summary(
        self, client: TestClient, db_session: Session, create_survey, auth_headers: dict
    ):
        survey = create_survey()
        statuses = [
            ProcessingStatus.pending,
            ProcessingStatus.pending,
            ProcessingStatus.processing,
            ProcessingStatus.completed,
            ProcessingStatus.failed,
        ]
        for status in statuses:
            rec = AudioRecording(
                survey_id=survey.id,
                filename=f"rec_{uuid4().hex}.wav",
                r2_key=f"audio/test/{uuid4().hex}.wav",
                processing_status=status,
            )
            db_session.add(rec)
        db_session.commit()

        response = client.get(f"/api/surveys/{survey.id}/audio/processing-summary", headers=auth_headers)

        assert response.status_code == 200
        assert response.json() == {
            "pending": 2,
            "processing": 1,
            "completed": 1,
            "failed": 1,
            "total": 5,
        }

    def test_image_processing_summary(
        self, client: TestClient, db_session: Session, create_survey, auth_headers: dict
    ):
        survey = create_survey()
        for status in [ProcessingStatus.pending, ProcessingStatus.completed]:
            img = CameraTrapImage(
                survey_id=survey.id,
                filename=f"img_{uuid4().hex}.jpg",
                r2_key=f"images/test/{uuid4().hex}.jpg",
                processing_status=status,
            )
            db_session.add(img)
        db_session.commit()

        response = client.get(f"/api/surveys/{survey.id}/images/processing-summary", headers=auth_headers)

        assert response.status_code == 200
        body = response.json()
        assert body["pending"] == 1
        assert body["completed"] == 1
        assert body["total"] == 2

    def test_summary_for_missing_survey_is_404(self, client: TestClient, auth_headers: dict):
        response = client.get("/api/surveys/999999/audio/processing-summary", headers=auth_headers)
        assert response.status_code == 404
