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
    ring_colour: str = "black"


TRACKED_BIRDS: List[TrackerBird] = [
    TrackerBird("2402", "69c7b38d46109fd4693991e7", "female", "403/404"),
    TrackerBird("240D", "69c7b38f46109fd46939985a", "male", "1847/1848"),
    TrackerBird("2407", "69c7b38e46109fd46939952e", "male", "1801/1802"),
    TrackerBird("2405", "69c7b38e46109fd469399448", "male", "221/222"),
    TrackerBird("2408", "69c7b38e46109fd4693995a1", "male", "1707/1708"),
    TrackerBird("2404", "69c7b38e46109fd4693993d6", "male", "1952/1953"),
]

TRACKER_OBJECT_IDS: List[str] = [b.object_id for b in TRACKED_BIRDS]
BIRD_BY_OBJECT_ID: Dict[str, TrackerBird] = {b.object_id: b for b in TRACKED_BIRDS}
