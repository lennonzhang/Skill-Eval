#!/usr/bin/env python
"""Synthetic tests for the local product consistency algorithm."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import cv2
import numpy as np

from product_check import ROOT_DIR, analyze_pair, write_visualizations


SELFTEST_DIR = ROOT_DIR / "data" / "product-checks" / "selftest"


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def canvas(width: int = 256, height: int = 256) -> np.ndarray:
    return np.full((height, width, 3), 255, dtype=np.uint8)


def draw_product(
    image: np.ndarray,
    dx: int = 0,
    dy: int = 0,
    color: tuple[int, int, int] = (45, 90, 180),
    light: bool = False,
) -> np.ndarray:
    output = image.copy()
    product_color = (226, 230, 232) if light else color
    outline = (70, 70, 70) if light else (15, 25, 55)
    body = np.array([[78 + dx, 70 + dy], [170 + dx, 58 + dy], [190 + dx, 160 + dy], [96 + dx, 185 + dy]])
    cv2.fillPoly(output, [body], product_color)
    cv2.polylines(output, [body], isClosed=True, color=outline, thickness=4)
    cv2.circle(output, (128 + dx, 120 + dy), 28, (240, 210, 80), -1)
    cv2.circle(output, (128 + dx, 120 + dy), 28, outline, 3)
    cv2.line(output, (92 + dx, 86 + dy), (170 + dx, 75 + dy), (245, 245, 245), 3)
    return output


def run_case(name: str, source: np.ndarray, result: np.ndarray, validate) -> dict:
    analysis = analyze_pair(source, result)
    validate(analysis)
    return {
        "name": name,
        "status": analysis["status"],
        "score": analysis.get("suggestedScore"),
        "confidence": analysis.get("confidence"),
        "tags": analysis.get("tags", []),
        "unsupportedReason": analysis.get("unsupportedReason"),
        "metrics": analysis.get("metrics", {}),
    }


def main() -> int:
    shutil.rmtree(SELFTEST_DIR, ignore_errors=True)
    SELFTEST_DIR.mkdir(parents=True, exist_ok=True)

    source = draw_product(canvas())
    unchanged = source.copy()

    cases = []
    cases.append(
        run_case(
            "unchanged_product",
            source,
            unchanged,
            lambda a: (
                assert_true(a["status"] == "checked", "unchanged should be checked"),
                assert_true(a["suggestedScore"] == 5, "unchanged should score 5"),
                assert_true(a["confidence"] in {"high", "medium"}, "unchanged confidence should be usable"),
            ),
        )
    )

    moved = draw_product(canvas(), dx=16)
    cases.append(
        run_case(
            "moved_product",
            source,
            moved,
            lambda a: (
                assert_true(a["suggestedScore"] <= 2, "moved product should be capped low"),
                assert_true("product_moved" in a["tags"], "moved product should be tagged"),
            ),
        )
    )

    clipped = source.copy()
    cv2.rectangle(clipped, (152, 58), (204, 118), (255, 255, 255), -1)
    cases.append(
        run_case(
            "silhouette_damage",
            source,
            clipped,
            lambda a: (
                assert_true(a["suggestedScore"] <= 3, "clipped product should score <= 3"),
                assert_true("silhouette_damage" in a["tags"], "clipped product should be tagged"),
            ),
        )
    )

    recolored = draw_product(canvas(), color=(170, 45, 45))
    cases.append(
        run_case(
            "recolored_product",
            source,
            recolored,
            lambda a: (
                assert_true(a["suggestedScore"] <= 3, "recolored product should score <= 3"),
                assert_true("product_changed" in a["tags"], "recolored product should be tagged"),
            ),
        )
    )

    light_source = draw_product(canvas(), light=True)
    light_result = light_source.copy()
    cases.append(
        run_case(
            "light_product_dark_contour",
            light_source,
            light_result,
            lambda a: (
                assert_true(a["status"] == "checked", "light product should segment"),
                assert_true(a["confidence"] in {"high", "medium"}, "light product confidence should be usable"),
                assert_true(a["sourceBbox"]["width"] > 50, "light product bbox should be valid"),
            ),
        )
    )

    off_white_canvas = canvas()
    cv2.rectangle(off_white_canvas, (0, 0), (256, 50), (226, 224, 218), -1)
    off_white_source = draw_product(off_white_canvas)
    off_white_result = off_white_source.copy()
    cases.append(
        run_case(
            "off_white_background",
            off_white_source,
            off_white_result,
            lambda a: (
                assert_true(a["status"] == "checked", "off-white source should still be checked"),
                assert_true(a["confidence"] in {"low", "medium"}, "off-white source should lower confidence"),
                assert_true(a["suggestedScore"] >= 4, "unchanged off-white product should stay high"),
            ),
        )
    )

    cases.append(
        run_case(
            "pure_white_source",
            canvas(),
            canvas(),
            lambda a: (
                assert_true(a["status"] == "unsupported", "white source should be unsupported"),
                assert_true(
                    a["unsupportedReason"] == "unsupported_mask_too_small",
                    "white source should fail mask too small",
                ),
            ),
        )
    )

    cases.append(
        run_case(
            "size_mismatch",
            source,
            source[:240, :240],
            lambda a: (
                assert_true(a["status"] == "unsupported", "size mismatch should be unsupported"),
                assert_true(
                    a["unsupportedReason"] == "unsupported_size_mismatch",
                    "size mismatch reason should be explicit",
                ),
            ),
        )
    )

    background_changed = source.copy()
    background_changed[:, :] = (235, 242, 249)
    background_changed = draw_product(background_changed)
    cases.append(
        run_case(
            "background_only_changed",
            source,
            background_changed,
            lambda a: assert_true(a["suggestedScore"] >= 4, "background-only change should remain high"),
        )
    )

    shadow = source.copy()
    cv2.ellipse(shadow, (140, 190), (70, 12), 0, 0, 360, (215, 215, 215), -1)
    shadow = draw_product(shadow)
    cases.append(
        run_case(
            "outside_shadow_added",
            source,
            shadow,
            lambda a: assert_true(a["suggestedScore"] >= 4, "outside shadow should remain high"),
        )
    )

    visualization_analysis = analyze_pair(source, moved)
    overlays = write_visualizations(source, moved, visualization_analysis, SELFTEST_DIR / "overlays", "synthetic-moved")
    expected_overlay_keys = {"sourceMask", "resultMatch", "diffHeatmap"}
    assert_true(set(overlays) == expected_overlay_keys, "visualization should write all overlays")
    for path_value in overlays.values():
        path = ROOT_DIR / path_value
        assert_true(path.exists(), f"overlay missing: {path_value}")

    payload = {
        "ok": True,
        "cases": cases,
        "overlays": overlays,
    }
    (SELFTEST_DIR / "results.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
