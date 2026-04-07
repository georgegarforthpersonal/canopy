"""Camera trap image analysis using iNaturalist EVA02 model (10,000 species)."""

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from PIL import Image
from PIL.ExifTags import TAGS

logger = logging.getLogger(__name__)

DEFAULT_CONFIDENCE_THRESHOLD = 0.7
DEFAULT_REVIEW_THRESHOLD = 0.4
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp"}
ALWAYS_REVIEW_SPECIES = {"felis silvestris", "felis catus"}


@dataclass
class Classification:
    scientific_name: str
    common_name: str
    confidence: float
    taxonomic_level: str
    taxonomy: dict = field(default_factory=dict)


@dataclass
class ImageResult:
    filepath: str
    timestamp: datetime | None
    classification: Classification | None
    flagged_for_review: bool
    review_reason: str | None
    top_predictions: list[dict]

    def __str__(self) -> str:
        ts = self.timestamp.strftime("%Y-%m-%d %H:%M:%S") if self.timestamp else "unknown"
        if self.classification:
            status = " [REVIEW]" if self.flagged_for_review else ""
            return (
                f"{Path(self.filepath).name} [{ts}] "
                f"{self.classification.common_name} ({self.classification.scientific_name}) "
                f"({self.classification.confidence:.1%}){status}"
            )
        return f"{Path(self.filepath).name} [{ts}] No species detected"

    def to_dict(self) -> dict:
        return {
            "filepath": self.filepath,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "classification": {
                "scientific_name": self.classification.scientific_name,
                "common_name": self.classification.common_name,
                "confidence": self.classification.confidence,
                "taxonomic_level": self.classification.taxonomic_level,
                "taxonomy": self.classification.taxonomy,
            } if self.classification else None,
            "flagged_for_review": self.flagged_for_review,
            "review_reason": self.review_reason,
            "top_predictions": self.top_predictions,
        }


class SpeciesClassifier:
    """Species classifier using EVA02 model fine-tuned on iNaturalist 2021."""

    MODEL_NAME = "hf-hub:timm/eva02_large_patch14_clip_336.merged2b_ft_inat21"

    def __init__(self) -> None:
        self.model: Any = None
        self.transform: Any = None
        self.label_names: list[str] | None = None
        self.label_descriptions: dict[str, str] | None = None
        self._loaded = False

    def load(self) -> bool:
        if self._loaded:
            return True

        try:
            import timm

            logger.info("Loading species classification model...")
            self.model = timm.create_model(self.MODEL_NAME, pretrained=True)
            self.model.eval()

            data_config = timm.data.resolve_model_data_config(self.model)
            self.transform = timm.data.create_transform(**data_config, is_training=False)

            cfg = self.model.pretrained_cfg
            self.label_names = cfg.get("label_names", [])
            self.label_descriptions = cfg.get("label_descriptions", {})

            logger.info(f"Model loaded ({len(self.label_names)} species)")
            self._loaded = True
            return True
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            return False

    def predict_from_pil(self, image: Image.Image, top_k: int = 5) -> list[dict]:
        """Run species prediction on an already-opened PIL Image."""
        if not self._loaded and not self.load():
            return []

        import torch

        try:
            rgb = image.convert("RGB")
            img_tensor = self.transform(rgb).unsqueeze(0)

            with torch.no_grad():
                outputs = self.model(img_tensor)

            probs = torch.nn.functional.softmax(outputs, dim=-1)
            top_probs, top_indices = probs[0].topk(top_k)

            predictions = []
            label_names = self.label_names or []
            label_descriptions = self.label_descriptions or {}
            for prob, idx in zip(top_probs, top_indices):
                idx_val = idx.item()
                scientific_name = label_names[idx_val] if idx_val < len(label_names) else f"class_{idx_val}"
                description = label_descriptions.get(scientific_name, "")
                common_name = description.split(",")[0].strip() if description else scientific_name

                predictions.append({
                    "scientific_name": scientific_name,
                    "common_name": common_name,
                    "confidence": prob.item(),
                })

            return predictions
        except Exception as e:
            logger.error(f"Prediction failed: {e}")
            return []

    def predict(self, image_path: Path, top_k: int = 5) -> list[dict]:
        if not self._loaded and not self.load():
            return []

        try:
            image = Image.open(image_path).convert("RGB")
            return self.predict_from_pil(image, top_k)
        except Exception as e:
            logger.error(f"Failed to open image {image_path}: {e}")
            return []


_classifier: SpeciesClassifier | None = None


def get_classifier() -> SpeciesClassifier:
    global _classifier
    if _classifier is None:
        _classifier = SpeciesClassifier()
    return _classifier


def crop_and_classify(
    image: Image.Image,
    boxes: list[dict],
    padding_fraction: float = 0.15,
    top_k: int = 3,
) -> list[list[dict]]:
    """Crop image to each bounding box (with padding) and classify each crop.

    Args:
        image: PIL Image already opened.
        boxes: List of dicts with normalised coords {x, y, w, h} (0-1).
        padding_fraction: Fraction of box size to add as padding.
        top_k: Number of top predictions per crop.

    Returns:
        List of prediction lists, one per box. If boxes is empty, classifies
        the full image and returns a single-element list.
    """
    classifier = get_classifier()
    if not classifier.load():
        logger.error("Failed to load classifier for crop_and_classify")
        return []

    rgb = image.convert("RGB")
    img_w, img_h = rgb.size

    if not boxes:
        predictions = classifier.predict_from_pil(rgb, top_k)
        return [predictions]

    results: list[list[dict]] = []
    for box in boxes:
        bx, by, bw, bh = box["x"], box["y"], box["w"], box["h"]

        # Convert normalised coords to pixels
        px = bx * img_w
        py = by * img_h
        pw = bw * img_w
        ph = bh * img_h

        # Add padding
        pad_x = pw * padding_fraction
        pad_y = ph * padding_fraction
        left = max(0, px - pad_x)
        top = max(0, py - pad_y)
        right = min(img_w, px + pw + pad_x)
        bottom = min(img_h, py + ph + pad_y)

        crop = rgb.crop((int(left), int(top), int(right), int(bottom)))
        predictions = classifier.predict_from_pil(crop, top_k)
        results.append(predictions)

    return results


def _get_image_timestamp(image_path: Path) -> datetime | None:
    try:
        with Image.open(image_path) as img:
            exif_data = img._getexif()
            if exif_data:
                for tag_id, value in exif_data.items():
                    tag = TAGS.get(tag_id, tag_id)
                    if tag in ("DateTimeOriginal", "DateTime"):
                        return datetime.strptime(value, "%Y:%m:%d %H:%M:%S")
    except Exception:
        pass

    patterns: list[tuple[str, Any]] = [
        (r"(\d{8})_(\d{6})", lambda g: datetime.strptime(f"{g[0]}_{g[1]}", "%Y%m%d_%H%M%S")),
        (r"(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})", lambda g: datetime(int(g[0]), int(g[1]), int(g[2]), int(g[3]), int(g[4]), int(g[5]))),
    ]
    for pattern, parser in patterns:
        match = re.search(pattern, image_path.stem)
        if match:
            try:
                result: datetime | None = parser(match.groups())
                return result
            except ValueError:
                continue
    return None


def _find_images(directory: Path) -> list[Path]:
    images: list[Path] = []
    for ext in IMAGE_EXTENSIONS:
        images.extend(directory.glob(f"*{ext}"))
        images.extend(directory.glob(f"*{ext.upper()}"))
    return sorted(images)


def _should_flag_for_review(
    classification: Classification | None,
    confidence_threshold: float,
    review_threshold: float,
) -> tuple[bool, str | None]:
    if not classification:
        return False, None

    if classification.scientific_name.lower() in ALWAYS_REVIEW_SPECIES:
        return True, "Wildcat/domestic cat confusion risk"

    if classification.confidence < review_threshold:
        return True, f"Very low confidence ({classification.confidence:.1%})"

    if classification.confidence < confidence_threshold:
        return True, f"Low confidence ({classification.confidence:.1%})"

    return False, None


def analyze_image(
    image_path: Path,
    confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
    review_threshold: float = DEFAULT_REVIEW_THRESHOLD,
) -> ImageResult:
    classifier = get_classifier()
    timestamp = _get_image_timestamp(image_path)
    predictions = classifier.predict(image_path)

    classification = None
    if predictions:
        top = predictions[0]
        classification = Classification(
            scientific_name=top["scientific_name"],
            common_name=top["common_name"],
            confidence=top["confidence"],
            taxonomic_level="species",
        )

    flagged, reason = _should_flag_for_review(classification, confidence_threshold, review_threshold)

    return ImageResult(
        filepath=str(image_path),
        timestamp=timestamp,
        classification=classification,
        flagged_for_review=flagged,
        review_reason=reason,
        top_predictions=predictions,
    )


def analyze_directory(
    directory: Path,
    confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
    review_threshold: float = DEFAULT_REVIEW_THRESHOLD,
) -> list[ImageResult]:
    images = _find_images(directory)
    if not images:
        logger.warning(f"No images found in {directory}")
        return []

    logger.info(f"Found {len(images)} images in {directory}")

    classifier = get_classifier()
    if not classifier.load():
        raise RuntimeError("Failed to load classification model")

    results = []
    for i, image_path in enumerate(images):
        logger.info(f"Processing {i + 1}/{len(images)}: {image_path.name}")
        result = analyze_image(image_path, confidence_threshold, review_threshold)
        results.append(result)

    return results


def get_summary_statistics(results: list[ImageResult]) -> dict:
    species_counts: dict[str, int] = {}
    for result in results:
        if result.classification:
            name = result.classification.scientific_name
            species_counts[name] = species_counts.get(name, 0) + 1

    confidences = [r.classification.confidence for r in results if r.classification]
    avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0

    return {
        "total_images": len(results),
        "images_with_classifications": sum(1 for r in results if r.classification),
        "images_flagged_for_review": sum(1 for r in results if r.flagged_for_review),
        "species_counts": dict(sorted(species_counts.items(), key=lambda x: -x[1])),
        "average_confidence": avg_confidence,
        "confidence_distribution": {
            "high_90_100": sum(1 for c in confidences if c >= 0.9),
            "medium_70_90": sum(1 for c in confidences if 0.7 <= c < 0.9),
            "low_40_70": sum(1 for c in confidences if 0.4 <= c < 0.7),
            "very_low_0_40": sum(1 for c in confidences if c < 0.4),
        },
    }
