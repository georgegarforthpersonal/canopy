"""MegaDetector V6 service for filtering false positive camera trap images."""

import logging
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image

logger = logging.getLogger(__name__)

# MegaDetector detection categories
CATEGORY_ANIMAL = "animal"
CATEGORY_PERSON = "person"
CATEGORY_VEHICLE = "vehicle"

# Confidence threshold for considering a detection valid.
# Deliberately low to avoid filtering real animals.
DETECTION_CONFIDENCE_THRESHOLD = 0.15

# Map MegaDetector label strings/IDs to canonical category names
CATEGORY_MAP: dict[str, str] = {
    "animal": CATEGORY_ANIMAL, "person": CATEGORY_PERSON, "vehicle": CATEGORY_VEHICLE,
    # MegaDetector ID convention (1-indexed)
    "1": CATEGORY_ANIMAL, "2": CATEGORY_PERSON, "3": CATEGORY_VEHICLE,
    # YOLO ID convention (0-indexed)
    "0": CATEGORY_ANIMAL,
}


@dataclass
class BoundingBox:
    x: float  # normalised 0-1 (left)
    y: float  # normalised 0-1 (top)
    w: float  # normalised 0-1 (width)
    h: float  # normalised 0-1 (height)
    confidence: float
    category: str


@dataclass
class DetectionResult:
    has_animal: bool
    max_animal_confidence: float
    categories_found: list[str]
    boxes: list[BoundingBox]


class MegaDetectorService:
    """MegaDetector V6 for filtering blank/false positive camera trap images."""

    def __init__(self) -> None:
        self.model: Any = None
        self._np: Any = None
        self._loaded = False

    def load(self) -> bool:
        if self._loaded:
            return True

        try:
            from PytorchWildlife.models import detection as pw_detection
            import numpy as np
            import torch

            device = "cuda" if torch.cuda.is_available() else "cpu"
            logger.info(f"Loading MegaDetector V6 model (device={device})...")
            self.model = pw_detection.MegaDetectorV6(version="MDV6-yolov9-c", device=device)
            self._np = np
            logger.info("MegaDetector V6 loaded successfully")
            self._loaded = True
            return True
        except Exception as e:
            logger.error(f"Failed to load MegaDetector: {e}")
            return False

    def detect(self, image_path: Path) -> DetectionResult:
        """Run MegaDetector on a single image.

        Returns detection result with animal presence and confidence.
        """
        if not self._loaded and not self.load():
            raise RuntimeError("MegaDetector model not loaded")

        try:
            np = self._np

            # Load and prepare image
            img = Image.open(image_path).convert("RGB")
            img_array = np.array(img)

            # Run detection
            results = self.model.single_image_detection(img_array)
            img_w, img_h = img.size

            max_animal_conf = 0.0
            categories_found: list[str] = []
            boxes: list[BoundingBox] = []

            # Extract detections from result dict.
            # PytorchWildlife returns {"detections": list of tuples/lists, "labels": list}.
            # Each detection row has 6 elements: [x1, y1, x2, y2, conf, category_id]
            # where coords are pixel values and category_id may be int or str.
            det_data = results.get("detections") if isinstance(results, dict) else None
            labels = (results.get("labels") or []) if isinstance(results, dict) else []

            if det_data is not None and hasattr(det_data, '__len__'):
                for i, det in enumerate(det_data):
                    try:
                        # PytorchWildlife format: [bbox_array, category_or_None, confidence]
                        # where bbox_array is np.array([x1, y1, x2, y2])
                        det = list(det)

                        if len(det) >= 3 and hasattr(det[0], '__len__'):
                            # Format: [array([x1,y1,x2,y2]), category, confidence]
                            bbox = det[0]
                            if hasattr(bbox, 'tolist'):
                                bbox = bbox.tolist()
                            x1, y1, x2, y2 = float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])
                            conf = float(det[2]) if det[2] is not None else 0.0
                        elif len(det) >= 5:
                            # Flat format: [x1, y1, x2, y2, conf, ...]
                            x1, y1, x2, y2, conf = float(det[0]), float(det[1]), float(det[2]), float(det[3]), float(det[4])
                        else:
                            continue

                        # Category from labels list or default
                        # Labels may be names ("animal") or IDs ("0"/"1")
                        raw_label = str(labels[i]).lower().strip() if i < len(labels) and labels[i] is not None else ""
                        cat_name = CATEGORY_MAP.get(raw_label, CATEGORY_ANIMAL)

                        if conf >= DETECTION_CONFIDENCE_THRESHOLD:
                            if cat_name not in categories_found:
                                categories_found.append(cat_name)

                            boxes.append(BoundingBox(
                                x=x1 / img_w,
                                y=y1 / img_h,
                                w=(x2 - x1) / img_w,
                                h=(y2 - y1) / img_h,
                                confidence=conf,
                                category=cat_name,
                            ))

                        if cat_name == CATEGORY_ANIMAL and conf > max_animal_conf:
                            max_animal_conf = conf

                    except (ValueError, IndexError, TypeError) as row_err:
                        logger.warning(f"Skipping detection row {i}: {row_err} (raw={repr(det)[:200]})")

            has_animal = max_animal_conf >= DETECTION_CONFIDENCE_THRESHOLD

            return DetectionResult(
                has_animal=has_animal,
                max_animal_confidence=max_animal_conf,
                categories_found=categories_found,
                boxes=boxes,
            )

        except Exception as e:
            logger.error(f"MegaDetector detection failed for {image_path}: {e}")
            # Safe default: assume there's an animal so we don't hide real images
            return DetectionResult(
                has_animal=True,
                max_animal_confidence=0.0,
                categories_found=[],
                boxes=[],
            )


_detector: MegaDetectorService | None = None


def get_detector() -> MegaDetectorService:
    global _detector
    if _detector is None:
        _detector = MegaDetectorService()
    return _detector
