#!/usr/bin/env python
"""Local reference-based product consistency checks for cached review images.

This script intentionally reads the existing SQLite item/cache records and writes
only ignored local artifacts under data/product-checks/. It does not write review
scores back into the application database.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sqlite3
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageOps
from skimage.metrics import structural_similarity


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE = ROOT_DIR / "data" / "app.sqlite"
DEFAULT_OUTPUT_DIR = ROOT_DIR / "data" / "product-checks"
SUPPORTED_IMAGE_STATUSES = {"success"}


@dataclass(frozen=True)
class BBox:
    x: int
    y: int
    width: int
    height: int

    @property
    def x2(self) -> int:
        return self.x + self.width

    @property
    def y2(self) -> int:
        return self.y + self.height

    def shifted(self, dx: int, dy: int) -> "BBox":
        return BBox(self.x + dx, self.y + dy, self.width, self.height)

    def as_dict(self) -> dict[str, int]:
        return {"x": self.x, "y": self.y, "width": self.width, "height": self.height}


def _relpath(path: Path) -> str:
    try:
        return path.resolve().relative_to(ROOT_DIR).as_posix()
    except ValueError:
        return path.as_posix()


def _clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, float(value)))


def _round_float(value: float | None, digits: int = 4) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(float(value), digits)


def read_rgb_image(path: Path) -> np.ndarray:
    with Image.open(path) as image:
        image = ImageOps.exif_transpose(image)
        if image.mode == "RGBA":
            background = Image.new("RGBA", image.size, (255, 255, 255, 255))
            image = Image.alpha_composite(background, image)
        image = image.convert("RGB")
        return np.asarray(image, dtype=np.uint8)


def _connected_border_labels(labels: np.ndarray) -> set[int]:
    border = np.concatenate(
        [
            labels[0, :],
            labels[-1, :],
            labels[:, 0],
            labels[:, -1],
        ]
    )
    return {int(label) for label in np.unique(border) if int(label) != 0}


def _fill_holes(mask: np.ndarray) -> np.ndarray:
    inverse = ~mask
    count, labels = cv2.connectedComponents(inverse.astype(np.uint8), connectivity=8)
    if count <= 1:
        return mask
    border_labels = _connected_border_labels(labels)
    holes = inverse & ~np.isin(labels, list(border_labels))
    return mask | holes


def _largest_components(mask: np.ndarray) -> np.ndarray:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    if count <= 1:
        return mask

    image_area = mask.shape[0] * mask.shape[1]
    components: list[dict[str, Any]] = []
    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < max(8, int(image_area * 0.00005)):
            continue
        x = int(stats[label, cv2.CC_STAT_LEFT])
        y = int(stats[label, cv2.CC_STAT_TOP])
        w = int(stats[label, cv2.CC_STAT_WIDTH])
        h = int(stats[label, cv2.CC_STAT_HEIGHT])
        touches_border = x <= 0 or y <= 0 or x + w >= mask.shape[1] or y + h >= mask.shape[0]
        components.append(
            {
                "label": label,
                "area": area,
                "touches_border": touches_border,
            }
        )

    if not components:
        return np.zeros_like(mask, dtype=bool)

    non_border = [component for component in components if not component["touches_border"]]
    candidates = non_border if non_border else components
    candidates.sort(key=lambda component: component["area"], reverse=True)
    largest_area = candidates[0]["area"]
    minimum_area = max(int(largest_area * 0.08), int(image_area * 0.0005), 16)
    keep_labels = [component["label"] for component in candidates[:6] if component["area"] >= minimum_area]
    if not keep_labels:
        keep_labels = [candidates[0]["label"]]
    return np.isin(labels, keep_labels)


def segment_source_product(source_rgb: np.ndarray) -> dict[str, Any]:
    """Segment the foreground product from a mostly white source background."""

    height, width = source_rgb.shape[:2]
    rgb_float = source_rgb.astype(np.int16)
    white_distance = np.linalg.norm(rgb_float - 255, axis=2)
    hsv = cv2.cvtColor(source_rgb, cv2.COLOR_RGB2HSV)
    gray = cv2.cvtColor(source_rgb, cv2.COLOR_RGB2GRAY)
    saturation = hsv[:, :, 1]
    white_candidate = (white_distance < 45) & (saturation < 35)
    source_white_bg_ratio = float(np.mean(white_candidate))

    edges = cv2.Canny(gray, 35, 120)
    edge_kernel = np.ones((3, 3), np.uint8)
    edge_barrier = cv2.dilate(edges, edge_kernel, iterations=1) > 0
    passable_background = white_candidate & ~edge_barrier

    count, labels = cv2.connectedComponents(passable_background.astype(np.uint8), connectivity=8)
    if count <= 1:
        flooded_background = np.zeros((height, width), dtype=bool)
    else:
        border_labels = _connected_border_labels(labels)
        flooded_background = np.isin(labels, list(border_labels)) & passable_background

    product_mask = ~flooded_background
    product_mask = cv2.morphologyEx(product_mask.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)) > 0
    product_mask = cv2.morphologyEx(product_mask.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0
    product_mask = _fill_holes(product_mask)
    product_mask = _largest_components(product_mask)
    product_mask = _fill_holes(product_mask)

    area = int(np.count_nonzero(product_mask))
    image_area = height * width
    area_ratio = area / image_area if image_area else 0.0

    bbox = None
    fill_ratio = 0.0
    if area:
        x, y, w, h = cv2.boundingRect(product_mask.astype(np.uint8))
        bbox = BBox(int(x), int(y), int(w), int(h))
        fill_ratio = area / max(1, bbox.width * bbox.height)

    unsupported_reason = None
    if source_white_bg_ratio < 0.60:
        unsupported_reason = "unsupported_not_white_background"
    elif area_ratio < 0.005:
        unsupported_reason = "unsupported_mask_too_small"
    elif area_ratio > 0.45:
        unsupported_reason = "unsupported_mask_too_large"

    confidence = "high"
    if unsupported_reason:
        confidence = "low"
    elif fill_ratio < 0.15 or source_white_bg_ratio < 0.70 or area_ratio < 0.02 or area_ratio > 0.35:
        confidence = "low"
    elif source_white_bg_ratio < 0.85:
        confidence = "medium"

    return {
        "mask": product_mask,
        "bbox": bbox,
        "unsupportedReason": unsupported_reason,
        "confidence": confidence,
        "quality": {
            "sourceWhiteBgRatio": source_white_bg_ratio,
            "maskAreaRatio": area_ratio,
            "maskArea": area,
            "fillRatio": fill_ratio,
        },
    }


def _masked_gray_ncc(source_rgb: np.ndarray, result_rgb: np.ndarray, mask: np.ndarray) -> float:
    source_gray = cv2.cvtColor(source_rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    result_gray = cv2.cvtColor(result_rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    source_pixels = source_gray[mask]
    result_pixels = result_gray[mask]
    if source_pixels.size < 2:
        return 0.0
    source_centered = source_pixels - float(np.mean(source_pixels))
    result_centered = result_pixels - float(np.mean(result_pixels))
    denominator = float(np.linalg.norm(source_centered) * np.linalg.norm(result_centered))
    if denominator < 1e-6:
        return 1.0 if float(np.mean(np.abs(source_pixels - result_pixels))) < 2.0 else 0.0
    return float(np.clip(np.dot(source_centered, result_centered) / denominator, -1.0, 1.0))


def _masked_ssim(source_rgb: np.ndarray, result_rgb: np.ndarray, mask: np.ndarray, bbox: BBox) -> tuple[float, float]:
    source_crop = source_rgb[bbox.y : bbox.y2, bbox.x : bbox.x2]
    result_crop = result_rgb[bbox.y : bbox.y2, bbox.x : bbox.x2]
    mask_crop = mask[bbox.y : bbox.y2, bbox.x : bbox.x2]
    if min(source_crop.shape[:2]) < 7 or np.count_nonzero(mask_crop) < 8:
        return 0.0, 0.0

    source_gray = cv2.cvtColor(source_crop, cv2.COLOR_RGB2GRAY)
    result_gray = cv2.cvtColor(result_crop, cv2.COLOR_RGB2GRAY)
    crop_ssim, ssim_map = structural_similarity(
        source_gray,
        result_gray,
        data_range=255,
        full=True,
        gaussian_weights=True,
        sigma=1.5,
        use_sample_covariance=False,
    )
    masked_values = ssim_map[mask_crop]
    masked_ssim = float(np.mean(masked_values)) if masked_values.size else float(crop_ssim)
    return float(crop_ssim), masked_ssim


def _local_offset_search(
    source_rgb: np.ndarray,
    result_rgb: np.ndarray,
    mask: np.ndarray,
    bbox: BBox,
    search_radius: int = 32,
) -> dict[str, Any]:
    source_crop = source_rgb[bbox.y : bbox.y2, bbox.x : bbox.x2].astype(np.int16)
    mask_crop = mask[bbox.y : bbox.y2, bbox.x : bbox.x2]
    if source_crop.size == 0 or np.count_nonzero(mask_crop) == 0:
        return {
            "dx": 0,
            "dy": 0,
            "magnitude": 0.0,
            "bestOffsetDiff": 1.0,
            "matchScore": 0.0,
        }

    height, width = result_rgb.shape[:2]

    def offset_diff(dx: int, dy: int) -> float | None:
        shifted = bbox.shifted(dx, dy)
        if shifted.x < 0 or shifted.y < 0 or shifted.x2 > width or shifted.y2 > height:
            return None
        result_crop = result_rgb[shifted.y : shifted.y2, shifted.x : shifted.x2].astype(np.int16)
        diff = np.abs(source_crop - result_crop).mean(axis=2) / 255.0
        return float(np.mean(diff[mask_crop]))

    best_dx = 0
    best_dy = 0
    best_diff = offset_diff(0, 0)
    if best_diff is None:
        best_diff = 1.0

    for dy in range(-search_radius, search_radius + 1, 4):
        for dx in range(-search_radius, search_radius + 1, 4):
            diff = offset_diff(dx, dy)
            if diff is not None and diff < best_diff:
                best_dx, best_dy, best_diff = dx, dy, diff

    coarse_dx, coarse_dy = best_dx, best_dy
    for dy in range(coarse_dy - 4, coarse_dy + 5):
        for dx in range(coarse_dx - 4, coarse_dx + 5):
            if abs(dx) > search_radius or abs(dy) > search_radius:
                continue
            diff = offset_diff(dx, dy)
            if diff is not None and diff < best_diff:
                best_dx, best_dy, best_diff = dx, dy, diff

    magnitude = math.sqrt(best_dx * best_dx + best_dy * best_dy)
    match_score = _clamp(1.0 - (best_diff / 0.45))
    return {
        "dx": int(best_dx),
        "dy": int(best_dy),
        "magnitude": float(magnitude),
        "bestOffsetDiff": float(best_diff),
        "matchScore": float(match_score),
    }


def compute_metrics(source_rgb: np.ndarray, result_rgb: np.ndarray, mask: np.ndarray, bbox: BBox) -> dict[str, Any]:
    abs_diff = np.abs(source_rgb.astype(np.int16) - result_rgb.astype(np.int16)).mean(axis=2) / 255.0
    masked_diff = abs_diff[mask]
    mean_abs_diff = float(np.mean(masked_diff)) if masked_diff.size else 1.0
    p90_abs_diff = float(np.percentile(masked_diff, 90)) if masked_diff.size else 1.0

    lab_source = cv2.cvtColor(source_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    lab_result = cv2.cvtColor(result_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    lab_delta = np.linalg.norm(lab_source - lab_result, axis=2) / 255.0
    masked_lab_delta = lab_delta[mask]
    lab_delta_mean = float(np.mean(masked_lab_delta)) if masked_lab_delta.size else 1.0

    kernel = np.ones((5, 5), np.uint8)
    dilated = cv2.dilate(mask.astype(np.uint8), kernel, iterations=1) > 0
    eroded = cv2.erode(mask.astype(np.uint8), kernel, iterations=1) > 0
    edge_band = dilated ^ eroded
    edge_values = abs_diff[edge_band]
    edge_band_diff = float(np.mean(edge_values)) if edge_values.size else mean_abs_diff

    crop_ssim, masked_ssim = _masked_ssim(source_rgb, result_rgb, mask, bbox)
    ncc = _masked_gray_ncc(source_rgb, result_rgb, mask)
    offset = _local_offset_search(source_rgb, result_rgb, mask, bbox)

    improvement = mean_abs_diff - float(offset["bestOffsetDiff"])
    edge_concentration = edge_band_diff / max(mean_abs_diff, 1e-6)

    return {
        "meanAbsDiff": mean_abs_diff,
        "p90AbsDiff": p90_abs_diff,
        "labDeltaMean": lab_delta_mean,
        "edgeBandDiff": edge_band_diff,
        "edgeConcentration": edge_concentration,
        "ssim": masked_ssim,
        "cropSsim": crop_ssim,
        "ncc": ncc,
        "bestOffset": offset,
        "offsetImprovement": improvement,
    }


def score_product(metrics: dict[str, Any]) -> tuple[int, list[str]]:
    mean_abs_diff = float(metrics["meanAbsDiff"])
    p90_abs_diff = float(metrics["p90AbsDiff"])
    edge_band_diff = float(metrics["edgeBandDiff"])
    ssim = float(metrics["ssim"])
    ncc = float(metrics["ncc"])
    offset = metrics["bestOffset"]
    match_score = float(offset["matchScore"])
    offset_magnitude = float(offset["magnitude"])
    improvement = float(metrics["offsetImprovement"])
    edge_concentration = float(metrics["edgeConcentration"])

    if match_score < 0.50 or mean_abs_diff > 0.34 or ncc < 0.45:
        score = 1
    elif offset_magnitude > 10 and improvement > 0.04:
        score = 2
    elif edge_band_diff > 0.24 or p90_abs_diff > 0.40 or ssim < 0.62:
        score = 2
    elif mean_abs_diff > 0.16 or ncc < 0.78 or ssim < 0.78:
        score = 3
    elif mean_abs_diff > 0.08 or edge_band_diff > 0.14 or ncc < 0.90 or ssim < 0.88:
        score = 4
    else:
        score = 5

    tags: list[str] = []
    if match_score < 0.50 or mean_abs_diff > 0.16 or ncc < 0.78 or ssim < 0.78:
        tags.append("product_changed")
    if offset_magnitude > 10 and improvement > 0.04:
        tags.append("product_moved")
    if edge_band_diff > 0.24 or p90_abs_diff > 0.40:
        tags.append("silhouette_damage")
    if edge_band_diff > 0.24 and edge_concentration > 1.25:
        tags.append("foreground_overlap")
    if p90_abs_diff > 0.45 and mean_abs_diff < 0.24:
        tags.append("artifact")

    return score, tags


def analyze_pair(source_rgb: np.ndarray, result_rgb: np.ndarray) -> dict[str, Any]:
    if source_rgb.shape != result_rgb.shape:
        return {
            "status": "unsupported",
            "unsupportedReason": "unsupported_size_mismatch",
            "suggestedScore": None,
            "confidence": "low",
            "tags": [],
            "metrics": {
                "sourceShape": list(source_rgb.shape[:2]),
                "resultShape": list(result_rgb.shape[:2]),
            },
        }

    segmentation = segment_source_product(source_rgb)
    quality = segmentation["quality"]
    mask = segmentation["mask"]
    bbox = segmentation["bbox"]
    unsupported_reason = segmentation["unsupportedReason"]
    if unsupported_reason or bbox is None:
        return {
            "status": "unsupported",
            "unsupportedReason": unsupported_reason or "unsupported_mask_unavailable",
            "suggestedScore": None,
            "confidence": "low",
            "tags": [],
            "maskQuality": {key: _round_float(value) for key, value in quality.items()},
            "sourceBbox": bbox.as_dict() if bbox else None,
        }

    metrics = compute_metrics(source_rgb, result_rgb, mask, bbox)
    score, tags = score_product(metrics)
    confidence = str(segmentation["confidence"])

    normalized_metrics = {
        "meanAbsDiff": _round_float(metrics["meanAbsDiff"]),
        "p90AbsDiff": _round_float(metrics["p90AbsDiff"]),
        "labDeltaMean": _round_float(metrics["labDeltaMean"]),
        "edgeBandDiff": _round_float(metrics["edgeBandDiff"]),
        "edgeConcentration": _round_float(metrics["edgeConcentration"]),
        "ssim": _round_float(metrics["ssim"]),
        "cropSsim": _round_float(metrics["cropSsim"]),
        "ncc": _round_float(metrics["ncc"]),
        "offsetImprovement": _round_float(metrics["offsetImprovement"]),
        "bestOffset": {
            "dx": metrics["bestOffset"]["dx"],
            "dy": metrics["bestOffset"]["dy"],
            "magnitude": _round_float(metrics["bestOffset"]["magnitude"]),
            "bestOffsetDiff": _round_float(metrics["bestOffset"]["bestOffsetDiff"]),
            "matchScore": _round_float(metrics["bestOffset"]["matchScore"]),
        },
    }

    return {
        "status": "checked",
        "unsupportedReason": None,
        "suggestedScore": score,
        "confidence": confidence,
        "tags": tags,
        "maskQuality": {key: _round_float(value) for key, value in quality.items()},
        "sourceBbox": bbox.as_dict(),
        "metrics": normalized_metrics,
        "_debug": {
            "mask": mask,
            "bbox": bbox,
        },
    }


def analyze_paths(source_path: Path, result_path: Path) -> dict[str, Any]:
    try:
        source_rgb = read_rgb_image(source_path)
    except Exception as error:  # noqa: BLE001 - CLI result should capture local file issues.
        return {
            "status": "unsupported",
            "unsupportedReason": "unsupported_source_read_failed",
            "suggestedScore": None,
            "confidence": "low",
            "tags": [],
            "error": str(error),
        }

    try:
        result_rgb = read_rgb_image(result_path)
    except Exception as error:  # noqa: BLE001 - CLI result should capture local file issues.
        return {
            "status": "unsupported",
            "unsupportedReason": "unsupported_result_read_failed",
            "suggestedScore": None,
            "confidence": "low",
            "tags": [],
            "error": str(error),
        }

    return analyze_pair(source_rgb, result_rgb)


def _apply_mask_overlay(image_rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
    overlay = image_rgb.copy().astype(np.float32)
    color = np.zeros_like(overlay)
    color[:, :, 1] = 255
    overlay[mask] = overlay[mask] * 0.55 + color[mask] * 0.45
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    output = np.clip(overlay, 0, 255).astype(np.uint8)
    cv2.drawContours(output, contours, -1, (0, 180, 0), 2)
    return output


def _draw_result_match(result_rgb: np.ndarray, bbox: BBox, metrics: dict[str, Any]) -> np.ndarray:
    output = result_rgb.copy()
    cv2.rectangle(output, (bbox.x, bbox.y), (bbox.x2, bbox.y2), (40, 120, 255), 3)
    offset = metrics["bestOffset"]
    shifted = bbox.shifted(int(offset["dx"]), int(offset["dy"]))
    cv2.rectangle(output, (shifted.x, shifted.y), (shifted.x2, shifted.y2), (255, 70, 70), 3)
    return output


def _draw_diff_heatmap(source_rgb: np.ndarray, result_rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
    diff = np.abs(source_rgb.astype(np.int16) - result_rgb.astype(np.int16)).mean(axis=2)
    scaled = np.clip(diff * 2.5, 0, 255).astype(np.uint8)
    heat_bgr = cv2.applyColorMap(scaled, cv2.COLORMAP_INFERNO)
    heat_rgb = cv2.cvtColor(heat_bgr, cv2.COLOR_BGR2RGB)
    output = result_rgb.copy().astype(np.float32)
    active = mask | (scaled > 30)
    output[active] = output[active] * 0.45 + heat_rgb[active].astype(np.float32) * 0.55
    return np.clip(output, 0, 255).astype(np.uint8)


def write_visualizations(
    source_rgb: np.ndarray,
    result_rgb: np.ndarray,
    analysis: dict[str, Any],
    overlays_dir: Path,
    item_id: str,
) -> dict[str, str]:
    debug = analysis.get("_debug") or {}
    mask = debug.get("mask")
    bbox = debug.get("bbox")
    if mask is None or bbox is None:
        return {}

    overlays_dir.mkdir(parents=True, exist_ok=True)
    outputs = {
        "sourceMask": overlays_dir / f"{item_id}-source-mask.png",
        "resultMatch": overlays_dir / f"{item_id}-result-match.png",
        "diffHeatmap": overlays_dir / f"{item_id}-diff-heatmap.png",
    }

    images = {
        "sourceMask": _apply_mask_overlay(source_rgb, mask),
        "resultMatch": _draw_result_match(result_rgb, bbox, analysis["metrics"]),
        "diffHeatmap": _draw_diff_heatmap(source_rgb, result_rgb, mask),
    }
    for key, image_rgb in images.items():
        cv2.imwrite(str(outputs[key]), cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR))

    return {key: _relpath(path) for key, path in outputs.items()}


def _clean_analysis_for_json(analysis: dict[str, Any]) -> dict[str, Any]:
    cleaned = dict(analysis)
    cleaned.pop("_debug", None)
    return cleaned


def resolve_local_path(path_value: str | None) -> Path | None:
    if not path_value:
        return None
    path = Path(path_value)
    if not path.is_absolute():
        path = ROOT_DIR / path
    return path


def fetch_rows(args: argparse.Namespace) -> tuple[list[sqlite3.Row], dict[str, Any]]:
    database_path = Path(args.database)
    if not database_path.is_absolute():
        database_path = ROOT_DIR / database_path
    if not database_path.exists():
        raise SystemExit(f"Database not found: {_relpath(database_path)}")

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    filters: dict[str, Any] = {
        "database": _relpath(database_path),
        "batch": args.batch,
        "model": args.model,
        "items": args.item or [],
        "all": bool(args.all),
    }

    try:
        if args.item:
            placeholders = ",".join("?" for _ in args.item)
            rows = connection.execute(
                f"""
                SELECT i.*, b.imported_at, b.name AS batch_name
                FROM items i
                JOIN batches b ON b.id = i.batch_id
                WHERE i.id IN ({placeholders})
                ORDER BY b.imported_at DESC, i.raw_json_file ASC, i.raw_index ASC
                """,
                args.item,
            ).fetchall()
            filters["resolvedBatchId"] = rows[0]["batch_id"] if rows else None
            return list(rows), filters

        if args.all:
            rows = connection.execute(
                """
                SELECT i.*, b.imported_at, b.name AS batch_name
                FROM items i
                JOIN batches b ON b.id = i.batch_id
                ORDER BY b.imported_at DESC, i.raw_json_file ASC, i.raw_index ASC
                """
            ).fetchall()
            filters["resolvedBatchId"] = "all-batches"
        else:
            batch_id = args.batch
            if not batch_id or batch_id == "latest":
                batch = connection.execute("SELECT id FROM batches ORDER BY imported_at DESC LIMIT 1").fetchone()
                if not batch:
                    raise SystemExit("No batches found. Run pnpm run import:resource first.")
                batch_id = batch["id"]
            rows = connection.execute(
                """
                SELECT i.*, b.imported_at, b.name AS batch_name
                FROM items i
                JOIN batches b ON b.id = i.batch_id
                WHERE i.batch_id = ?
                ORDER BY i.raw_json_file ASC, i.raw_index ASC, i.model ASC
                """,
                (batch_id,),
            ).fetchall()
            filters["resolvedBatchId"] = batch_id

        if args.model:
            needle = args.model.lower()
            rows = [row for row in rows if needle in str(row["model"]).lower()]

        if args.limit is not None:
            rows = rows[: args.limit]

        return list(rows), filters
    finally:
        connection.close()


def analyze_row(row: sqlite3.Row, output_dir: Path, visualize: bool) -> dict[str, Any]:
    source_path = resolve_local_path(row["source_image_path"])
    result_path = resolve_local_path(row["result_image_path"])
    item_result: dict[str, Any] = {
        "itemId": row["id"],
        "batchId": row["batch_id"],
        "model": row["model"],
        "sourceImagePath": row["source_image_path"],
        "resultImagePath": row["result_image_path"],
    }

    if (
        row["source_fetch_status"] not in SUPPORTED_IMAGE_STATUSES
        or row["result_fetch_status"] not in SUPPORTED_IMAGE_STATUSES
        or source_path is None
        or result_path is None
        or not source_path.exists()
        or not result_path.exists()
    ):
        item_result.update(
            {
                "status": "unsupported",
                "unsupportedReason": "unsupported_missing_cached_image",
                "suggestedScore": None,
                "confidence": "low",
                "tags": [],
            }
        )
        return item_result

    source_rgb = read_rgb_image(source_path)
    result_rgb = read_rgb_image(result_path)
    analysis = analyze_pair(source_rgb, result_rgb)
    overlays = {}
    if visualize:
        overlays = write_visualizations(source_rgb, result_rgb, analysis, output_dir / "overlays", row["id"])

    item_result.update(_clean_analysis_for_json(analysis))
    if overlays:
        item_result["overlays"] = overlays
    return item_result


def summarize(items: list[dict[str, Any]]) -> dict[str, Any]:
    checked = [item for item in items if item.get("status") == "checked"]
    unsupported = [item for item in items if item.get("status") != "checked"]
    scores = [int(item["suggestedScore"]) for item in checked if item.get("suggestedScore") is not None]
    tag_counts = Counter(tag for item in checked for tag in item.get("tags", []))
    reason_counts = Counter(item.get("unsupportedReason") for item in unsupported)
    return {
        "total": len(items),
        "checked": len(checked),
        "unsupported": len(unsupported),
        "avgSuggestedScore": _round_float(float(np.mean(scores)) if scores else None),
        "scoreCounts": {str(score): scores.count(score) for score in range(1, 6)},
        "tagCounts": dict(sorted(tag_counts.items())),
        "unsupportedReasons": dict(sorted((k, v) for k, v in reason_counts.items() if k)),
    }


def default_output_key(filters: dict[str, Any]) -> str:
    items = filters.get("items") or []
    if len(items) == 1:
        return str(items[0])
    if len(items) > 1:
        return "selected-items"
    if filters.get("resolvedBatchId"):
        return str(filters["resolvedBatchId"])
    return "selected-items"


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run local product consistency checks against cached source/result images."
    )
    parser.add_argument("--database", default=str(DEFAULT_DATABASE), help="SQLite database path.")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Directory for ignored local outputs.")
    parser.add_argument("--batch", default="latest", help="Batch id or 'latest'. Ignored when --item or --all is used.")
    parser.add_argument("--model", help="Case-insensitive model substring filter, for example gemini.")
    parser.add_argument("--item", action="append", help="Analyze one item id. Can be repeated.")
    parser.add_argument("--all", action="store_true", help="Analyze all batches.")
    parser.add_argument("--limit", type=int, help="Limit rows after filtering.")
    parser.add_argument("--visualize", action="store_true", help="Write source mask, match, and diff overlays.")
    return parser


def main() -> int:
    parser = build_arg_parser()
    args = parser.parse_args()
    if args.item and args.all:
        parser.error("--item and --all cannot be combined")

    rows, filters = fetch_rows(args)
    output_root = Path(args.output_dir)
    if not output_root.is_absolute():
        output_root = ROOT_DIR / output_root
    output_dir = output_root / default_output_key(filters)
    output_dir.mkdir(parents=True, exist_ok=True)

    items = [analyze_row(row, output_dir, args.visualize) for row in rows]
    payload = {
        "ok": True,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "filters": filters,
        "output": {"dir": _relpath(output_dir)},
        "summary": summarize(items),
        "items": items,
    }

    result_path = output_dir / "results.json"
    result_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "output": _relpath(result_path), "summary": payload["summary"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
