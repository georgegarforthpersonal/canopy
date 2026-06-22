"""Hardcoded tracker -> bird mapping for the Cannwood turtle doves.

Temporary single source of truth (will move to the DB); fields mirror the
future table. `tag` is the last 4 chars of the device uuid; rings are all black.
"""

from dataclasses import dataclass
from typing import Dict, List


@dataclass(frozen=True)
class TrackerBird:
    tag: str
    object_id: str
    sex: str
    ring_number: str
    # Stable map colour for this bird's track/pin, from the notionColors text palette.
    track_colour: str
    # ISO-UTC timestamp of this bird's first real fix. Fixes before this are
    # pre-release artifacts (Norfolk rearing site in May, then a Frome holding
    # stop on 2 Jun) and are dropped from the track. Picked per bird from the
    # first fix at the release site; 2408 stopped reporting at the Frome stop,
    # so its last Frome fix stands in as the first fix.
    first_fix: str
    ring_colour: str = "black"


TRACKED_BIRDS: List[TrackerBird] = [
    TrackerBird("2402", "69c7b38d46109fd4693991e7", "female", "403/404", "#2B5F86", "2026-06-04T16:00:31Z"),
    TrackerBird("240D", "69c7b38f46109fd46939985a", "male", "1847/1848", "#6940A5", "2026-06-04T14:00:26Z"),
    TrackerBird("2407", "69c7b38e46109fd46939952e", "male", "1801/1802", "#D9730D", "2026-06-03T14:00:37Z"),
    TrackerBird("2405", "69c7b38e46109fd469399448", "male", "221/222", "#4D6461", "2026-06-04T16:00:37Z"),
    TrackerBird("2408", "69c7b38e46109fd4693995a1", "male", "1707/1708", "#AD5E99", "2026-06-02T16:00:47Z"),
    TrackerBird("2404", "69c7b38e46109fd4693993d6", "male", "1952/1953", "#E03E3E", "2026-06-19T15:59:15Z"),
]

TRACKER_OBJECT_IDS: List[str] = [b.object_id for b in TRACKED_BIRDS]
BIRD_BY_OBJECT_ID: Dict[str, TrackerBird] = {b.object_id: b for b in TRACKED_BIRDS}


def first_fix_for(object_id: str) -> str:
    """First-fix ISO-UTC cutoff for a device, or "" if it isn't a tracked bird."""
    bird = BIRD_BY_OBJECT_ID.get(object_id)
    return bird.first_fix if bird else ""
