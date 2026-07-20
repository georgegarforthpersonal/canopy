"""
Durable, DB-backed job queue for media processing.

The processing_status column on audio_recording / camera_trap_image IS the
queue: uploads insert rows as 'pending' and nudge the dispatcher, which
claims batches with FOR UPDATE SKIP LOCKED (safe with multiple app replicas),
and runs the matching function from services/processing.py in a worker thread
with bounded concurrency and a per-job timeout.

The dispatcher only polls fast (job_poll_interval_seconds) while jobs are in
flight. When the queue is idle it sleeps until nudged, with a slow safety poll
(job_idle_poll_interval_seconds) to recover jobs enqueued by another replica
or orphaned by a crash. Keeping the idle cadence above Neon's 5-minute suspend
window is what lets an otherwise-idle database scale to zero.

Jobs survive restarts: rows left in 'processing' by a crashed or redeployed
server are swept back to 'pending' once their processing_started_at is older
than the timeout, until processing_attempts reaches the configured maximum,
after which they are marked 'failed'.
"""

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Callable, Optional

from sqlalchemy import text

from config import settings
from database.connection import get_session_factory
from services.processing import process_audio_recording, process_camera_trap_image

logger = logging.getLogger(__name__)

# How long to wait for in-flight jobs when shutting down. Threads cannot be
# killed; abandoned jobs are requeued later by the stale sweep.
SHUTDOWN_GRACE_SECONDS = 5

SWEEP_INTERVAL_SECONDS = 60

MAX_ERROR_LENGTH = 2000


@dataclass(frozen=True)
class JobKind:
    name: str
    table: str
    run: Callable[[int], None]


JOB_KINDS = [
    JobKind("audio", "audio_recording", process_audio_recording),
    JobKind("image", "camera_trap_image", process_camera_trap_image),
]


class JobDispatcher:
    def __init__(
        self,
        concurrency: Optional[int] = None,
        poll_interval: Optional[float] = None,
        idle_poll_interval: Optional[float] = None,
        max_attempts: Optional[int] = None,
        job_timeout: Optional[int] = None,
    ) -> None:
        self.concurrency = concurrency or settings.effective_job_concurrency
        self.poll_interval = poll_interval or settings.job_poll_interval_seconds
        self.idle_poll_interval = idle_poll_interval or settings.job_idle_poll_interval_seconds
        self.max_attempts = max_attempts or settings.job_max_attempts
        self.job_timeout = job_timeout or settings.job_timeout_seconds
        self._tasks: set["asyncio.Task[None]"] = set()
        self._loop_task: Optional["asyncio.Task[None]"] = None
        self._stopping = asyncio.Event()
        self._nudged = asyncio.Event()
        self._last_sweep: Optional[datetime] = None
        self._rotation = 0
        # Dedicated pool: asyncio's default executor is sized ~cpu+4, which
        # would silently cap concurrency below the configured value.
        self._executor = ThreadPoolExecutor(
            max_workers=self.concurrency, thread_name_prefix="job"
        )

    async def start(self) -> None:
        self._loop_task = asyncio.create_task(self._loop())
        logger.info(
            f"Job dispatcher started (concurrency={self.concurrency}, "
            f"poll={self.poll_interval}s, idle_poll={self.idle_poll_interval}s, "
            f"timeout={self.job_timeout}s, max_attempts={self.max_attempts})"
        )

    def nudge(self) -> None:
        """Wake the dispatcher immediately; called after enqueueing a job."""
        self._nudged.set()

    async def stop(self) -> None:
        self._stopping.set()
        if self._loop_task:
            await self._loop_task
        if self._tasks:
            logger.info(f"Waiting up to {SHUTDOWN_GRACE_SECONDS}s for {len(self._tasks)} job(s)")
            await asyncio.wait(self._tasks, timeout=SHUTDOWN_GRACE_SECONDS)
        self._executor.shutdown(wait=False)

    async def _loop(self) -> None:
        while not self._stopping.is_set():
            self._nudged.clear()
            try:
                await self._tick()
            except Exception:
                logger.exception("Job dispatcher tick failed")
            # Poll fast only while jobs are in flight; otherwise sleep until
            # nudged (or the safety poll) so an idle database can suspend.
            timeout = self.poll_interval if self._tasks else self.idle_poll_interval
            await self._wait_for_work(timeout)

    async def _wait_for_work(self, timeout: float) -> None:
        waits = [
            asyncio.create_task(self._stopping.wait()),
            asyncio.create_task(self._nudged.wait()),
        ]
        _, pending = await asyncio.wait(
            waits, timeout=timeout, return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()

    async def _tick(self) -> None:
        now = datetime.utcnow()
        if self._last_sweep is None or (now - self._last_sweep).total_seconds() >= SWEEP_INTERVAL_SECONDS:
            self._last_sweep = now
            await asyncio.to_thread(self.sweep_stale)

        free = self.concurrency - len(self._tasks)
        if free <= 0:
            return

        # Rotate which kind claims first so a large audio backlog cannot
        # starve image jobs (and vice versa).
        self._rotation += 1
        kinds = JOB_KINDS[self._rotation % len(JOB_KINDS):] + JOB_KINDS[:self._rotation % len(JOB_KINDS)]

        for kind in kinds:
            if free <= 0:
                break
            for row_id in await asyncio.to_thread(self.claim, kind, free):
                task = asyncio.create_task(self._run_job(kind, row_id))
                self._tasks.add(task)
                task.add_done_callback(self._tasks.discard)
                free -= 1

    def claim(self, kind: JobKind, limit: int) -> list[int]:
        """Atomically claim up to `limit` pending rows and mark them processing."""
        SessionLocal = get_session_factory()
        with SessionLocal() as db:
            rows = db.execute(
                text(
                    f"""
                    UPDATE {kind.table}
                    SET processing_status = 'processing',
                        processing_started_at = :now,
                        processing_error = NULL,
                        processing_attempts = processing_attempts + 1
                    WHERE id IN (
                        SELECT id FROM {kind.table}
                        WHERE processing_status = 'pending'
                        ORDER BY id
                        LIMIT :limit
                        FOR UPDATE SKIP LOCKED
                    )
                    RETURNING id
                    """
                ),
                {"now": datetime.utcnow(), "limit": limit},
            ).scalars().all()
            db.commit()
        if rows:
            logger.info(f"Claimed {len(rows)} {kind.name} job(s): {list(rows)}")
        return list(rows)

    def sweep_stale(self) -> None:
        """Requeue (or fail) rows stuck in 'processing' past the job timeout."""
        cutoff = datetime.utcnow() - timedelta(seconds=self.job_timeout * 1.5)
        SessionLocal = get_session_factory()
        with SessionLocal() as db:
            for kind in JOB_KINDS:
                result = db.execute(
                    text(
                        f"""
                        UPDATE {kind.table}
                        SET processing_status = CASE
                                WHEN processing_attempts >= :max_attempts THEN 'failed'
                                ELSE 'pending'
                            END,
                            processing_error = CASE
                                WHEN processing_attempts >= :max_attempts
                                THEN 'Processing was interrupted and exceeded the retry limit'
                                ELSE processing_error
                            END
                        WHERE processing_status = 'processing'
                          AND (processing_started_at IS NULL OR processing_started_at < :cutoff)
                        """
                    ),
                    {"max_attempts": self.max_attempts, "cutoff": cutoff},
                )
                if result.rowcount:
                    logger.warning(f"Requeued {result.rowcount} stale {kind.name} job(s)")
            db.commit()

    async def _run_job(self, kind: JobKind, row_id: int) -> None:
        loop = asyncio.get_running_loop()
        try:
            await asyncio.wait_for(
                loop.run_in_executor(self._executor, kind.run, row_id),
                timeout=self.job_timeout,
            )
        except Exception as e:
            if isinstance(e, TimeoutError):
                error = f"Timed out after {self.job_timeout}s"
                logger.error(f"{kind.name} job {row_id} timed out")
            else:
                error = str(e) or e.__class__.__name__
                logger.exception(f"{kind.name} job {row_id} failed")
            try:
                await asyncio.to_thread(self.record_failure, kind, row_id, error)
            except Exception:
                logger.exception(f"Could not record failure for {kind.name} job {row_id}")

    def record_failure(self, kind: JobKind, row_id: int, error: str) -> None:
        """Requeue a failed job, or mark it failed once out of attempts."""
        SessionLocal = get_session_factory()
        with SessionLocal() as db:
            db.execute(
                text(
                    f"""
                    UPDATE {kind.table}
                    SET processing_status = CASE
                            WHEN processing_attempts >= :max_attempts THEN 'failed'
                            ELSE 'pending'
                        END,
                        processing_error = :error
                    WHERE id = :id AND processing_status = 'processing'
                    """
                ),
                {
                    "max_attempts": self.max_attempts,
                    "error": error[:MAX_ERROR_LENGTH],
                    "id": row_id,
                },
            )
            db.commit()


_dispatcher: Optional[JobDispatcher] = None


async def start_dispatcher() -> None:
    global _dispatcher
    if _dispatcher is None:
        _dispatcher = JobDispatcher()
        await _dispatcher.start()


async def stop_dispatcher() -> None:
    global _dispatcher
    if _dispatcher is not None:
        await _dispatcher.stop()
        _dispatcher = None


def nudge_dispatcher() -> None:
    """Wake the in-process dispatcher after enqueueing jobs.

    No-op when the dispatcher is disabled (another replica's safety poll
    picks the jobs up instead).
    """
    if _dispatcher is not None:
        _dispatcher.nudge()
