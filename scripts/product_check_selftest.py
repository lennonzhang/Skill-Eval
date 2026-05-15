#!/usr/bin/env python
"""Synthetic tests for the local product consistency algorithm."""

from __future__ import annotations

import json
import shutil
import sqlite3
from pathlib import Path

import cv2
import numpy as np

from product_check import ROOT_DIR, analyze_pair, analyze_rows, write_visualizations


SELFTEST_DIR = ROOT_DIR / "data" / "product-checks" / "selftest"


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def make_row(**overrides: object) -> sqlite3.Row:
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    columns = {
        "id": "selftest-item",
        "batch_id": "selftest-batch",
        "model": "selftest-model",
        "source_image_path": None,
        "result_image_path": None,
        "source_fetch_status": "failed",
        "result_fetch_status": "failed",
    }
    columns.update(overrides)
    names = list(columns.keys())
    selectors = ", ".join(f"? AS {name}" for name in names)
    row = connection.execute(
        f"SELECT {selectors}",
        [columns[name] for name in names],
    ).fetchone()
    connection.close()
    return row


def canvas(width: int = 256, height: int = 256) -> np.ndarray:
    return np.full((height, width, 3), 255, dtype=np.uint8)


def noisy_white_canvas(width: int = 256, height: int = 256) -> np.ndarray:
    y, x = np.indices((height, width))
    noise = ((x * 3 + y * 5) % 17).astype(np.uint8)
    base = np.full((height, width, 3), 246, dtype=np.uint8)
    base[:, :, 0] = np.clip(base[:, :, 0] - noise, 0, 255)
    base[:, :, 1] = np.clip(base[:, :, 1] - (noise // 2), 0, 255)
    return base


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


def draw_edge_touching_product(image: np.ndarray) -> np.ndarray:
    output = image.copy()
    body = np.array([[0, 58], [94, 64], [114, 176], [0, 198]])
    outline = (18, 34, 64)
    cv2.fillPoly(output, [body], (54, 116, 168))
    cv2.polylines(output, [body], isClosed=True, color=outline, thickness=4)
    cv2.rectangle(output, (24, 104), (92, 142), (242, 244, 246), -1)
    cv2.rectangle(output, (24, 104), (92, 142), outline, 2)
    cv2.circle(output, (62, 88), 13, (236, 190, 68), -1)
    cv2.circle(output, (62, 88), 13, outline, 2)
    return output


def draw_ring_product(
    image: np.ndarray,
    center: tuple[int, int] = (128, 128),
    outer_radius: int = 58,
    inner_radius: int = 28,
    color: tuple[int, int, int] = (45, 90, 180),
) -> np.ndarray:
    output = image.copy()
    cv2.circle(output, center, outer_radius, color, -1)
    cv2.circle(output, center, outer_radius, (15, 25, 55), 4)
    cv2.circle(output, center, inner_radius, (255, 255, 255), -1)
    cv2.circle(output, center, inner_radius, (15, 25, 55), 4)
    return output


def draw_solid_white_product(image: np.ndarray) -> np.ndarray:
    output = image.copy()
    cv2.ellipse(output, (128, 128), (58, 38), 0, 0, 360, (238, 240, 242), -1)
    cv2.ellipse(output, (128, 128), (58, 38), 0, 0, 360, (80, 80, 80), 4)
    cv2.line(output, (92, 120), (164, 120), (225, 228, 230), 3)
    return output


def draw_bottle_with_white_label(image: np.ndarray, label_text: str = "BREEZE") -> np.ndarray:
    output = image.copy()
    cv2.rectangle(output, (94, 64), (162, 184), (142, 82, 28), -1)
    cv2.rectangle(output, (94, 64), (162, 184), (65, 45, 32), 4)
    cv2.rectangle(output, (86, 104), (170, 151), (246, 248, 248), -1)
    cv2.rectangle(output, (86, 104), (170, 151), (210, 214, 216), 1)
    cv2.putText(output, label_text, (96, 126), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (65, 65, 65), 1, cv2.LINE_AA)
    cv2.putText(output, "250ml", (111, 141), cv2.FONT_HERSHEY_SIMPLEX, 0.33, (80, 80, 80), 1, cv2.LINE_AA)
    cv2.rectangle(output, (108, 45), (148, 68), (25, 25, 25), -1)
    cv2.rectangle(output, (116, 24), (140, 48), (18, 18, 18), -1)
    return output


def draw_bag_with_handle_hole(image: np.ndarray, fill_hole: bool = False) -> np.ndarray:
    output = image.copy()
    bag_color = (212, 166, 78)
    outline = (115, 82, 38)
    body = np.array([[62, 112], [194, 112], [210, 198], [46, 198]])
    cv2.fillPoly(output, [body], bag_color)
    cv2.polylines(output, [body], isClosed=True, color=outline, thickness=4)
    cv2.ellipse(output, (128, 118), (54, 62), 0, 200, 340, outline, 10)
    cv2.ellipse(output, (128, 118), (39, 48), 0, 204, 336, bag_color, 8)
    if fill_hole:
        cv2.fillPoly(
            output,
            [
                np.array(
                    [
                        [72, 110],
                        [86, 78],
                        [111, 54],
                        [128, 48],
                        [145, 54],
                        [170, 78],
                        [184, 110],
                        [180, 121],
                        [76, 121],
                    ]
                )
            ],
            bag_color,
        )
    cv2.rectangle(output, (116, 125), (140, 164), (218, 174, 92), -1)
    cv2.rectangle(output, (116, 125), (140, 164), outline, 2)
    cv2.rectangle(output, (120, 132), (136, 146), (238, 203, 120), -1)
    cv2.rectangle(output, (120, 132), (136, 146), outline, 2)
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
        "scoreReasons": analysis.get("scoreReasons", []),
        "unsupportedReason": analysis.get("unsupportedReason"),
        "maskQuality": analysis.get("maskQuality", {}),
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
                assert_true(a["suggestedScore"] == 1, "moved product should be a hard 1"),
                assert_true("product_moved" in a["tags"], "moved product should be tagged"),
                assert_true(
                    a.get("damageSignals", {}).get("alignment", {}).get("moved") is True,
                    "moved product should expose alignment damage signal",
                ),
            ),
        )
    )

    tiny_shift = draw_product(canvas(), dx=3)
    cases.append(
        run_case(
            "tiny_shift_not_moved",
            source,
            tiny_shift,
            lambda a: (
                assert_true(a["suggestedScore"] >= 3, "tiny alignment noise should not be a hard low score"),
                assert_true("product_moved" not in a["tags"], "tiny shift should not be tagged as moved"),
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

    noisy_background_source = draw_product(noisy_white_canvas())
    cases.append(
        run_case(
            "non_perfect_white_background",
            noisy_background_source,
            noisy_background_source.copy(),
            lambda a: (
                assert_true(a["status"] == "checked", "non-perfect white background should still be checked"),
                assert_true(a["unsupportedReason"] is None, "non-perfect white background should not be unsupported"),
                assert_true(a["suggestedScore"] >= 4, "unchanged product on non-perfect white should stay high"),
                assert_true(
                    a["maskQuality"].get("borderRelaxedWhiteRatio", 0) > 0.60,
                    "border white prior should be captured as a diagnostic",
                ),
            ),
        )
    )

    edge_touching_source = draw_edge_touching_product(canvas())
    cases.append(
        run_case(
            "edge_touching_product",
            edge_touching_source,
            edge_touching_source.copy(),
            lambda a: (
                assert_true(a["status"] == "checked", "edge-touching product should be checked"),
                assert_true(a["sourceBbox"]["x"] == 0, "edge-touching product bbox should keep the border contact"),
                assert_true(a["maskQuality"].get("maskAreaRatio", 0) > 0.05, "edge-touching product mask should be substantial"),
                assert_true(a["suggestedScore"] >= 4, "unchanged edge-touching product should stay high"),
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

    white_label_source = draw_bottle_with_white_label(canvas())
    cases.append(
        run_case(
            "white_label_is_material",
            white_label_source,
            white_label_source.copy(),
            lambda a: (
                assert_true(a["status"] == "checked", "white-label bottle should be checked"),
                assert_true(a["maskQuality"].get("whiteMaterialAreaRatio", 0) > 0.005, "white label should be kept as material"),
                assert_true(a["maskQuality"].get("holeAreaRatio", 0) == 0, "white label should not be a hole"),
                assert_true(a["maskQuality"].get("holeConfidence") == "none", "white label should not expose a confident hole"),
                assert_true(a["suggestedScore"] >= 4, "unchanged white-label product should stay high"),
            ),
        )
    )

    white_label_changed = white_label_source.copy()
    cv2.rectangle(white_label_changed, (96, 112), (160, 142), (205, 214, 222), -1)
    cv2.putText(white_label_changed, "DRIFT", (101, 132), cv2.FONT_HERSHEY_SIMPLEX, 0.46, (35, 35, 35), 1, cv2.LINE_AA)
    cases.append(
        run_case(
            "white_label_text_changed_is_material",
            white_label_source,
            white_label_changed,
            lambda a: (
                assert_true("hole_filled" not in a["tags"], "label text change should not be treated as hole fill"),
                assert_true(a["maskQuality"].get("whiteMaterialAreaRatio", 0) > 0.005, "changed label should still be material"),
                assert_true(a["metrics"].get("materialP90Diff", 0) > 0.0, "label material should contribute to material diff"),
            ),
        )
    )

    bag_source = draw_bag_with_handle_hole(canvas())
    cases.append(
        run_case(
            "bag_handle_hole_detected",
            bag_source,
            bag_source.copy(),
            lambda a: (
                assert_true(a["status"] == "checked", "bag with handle hole should be checked"),
                assert_true(a["maskQuality"].get("holeAreaRatio", 0) > 0, "handle opening should be detected as a hole"),
                assert_true(a["maskQuality"].get("holeConfidence") in {"medium", "high"}, "handle opening should have hole confidence"),
                assert_true(a["suggestedScore"] >= 4, "unchanged bag should stay high"),
            ),
        )
    )

    bag_hole_filled = draw_bag_with_handle_hole(canvas(), fill_hole=True)
    cases.append(
        run_case(
            "bag_handle_hole_filled_is_diagnostic",
            bag_source,
            bag_hole_filled,
            lambda a: (
                assert_true(
                    a["maskQuality"].get("holeAreaRatio", 0) > 0,
                    "filled handle test should start from a detected source hole",
                ),
                assert_true(a["metrics"].get("holeClosureScore", 0) > 0.45, "filled handle should stay diagnostic"),
                assert_true("hole_filled" not in a["tags"], "filled handle should not hard-tag hole_filled"),
            ),
        )
    )

    ring_source = draw_ring_product(canvas())
    ring_hole_background_changed = ring_source.copy()
    cv2.circle(ring_hole_background_changed, (128, 128), 24, (232, 238, 244), -1)
    cases.append(
        run_case(
            "ring_hole_background_changed",
            ring_source,
            ring_hole_background_changed,
            lambda a: (
                assert_true(a["suggestedScore"] >= 4, "hole background change should remain high"),
                assert_true("hole_filled" not in a["tags"], "hole background change should not be hole_filled"),
                assert_true("silhouette_damage" not in a["tags"], "hole background change should not damage silhouette"),
            ),
        )
    )

    ring_hole_background_colored = ring_source.copy()
    cv2.circle(ring_hole_background_colored, (128, 128), 24, (186, 196, 206), -1)
    cases.append(
        run_case(
            "ring_hole_background_colored",
            ring_source,
            ring_hole_background_colored,
            lambda a: (
                assert_true(a["maskQuality"].get("holeAreaRatio", 0) > 0, "source ring hole should be detected"),
                assert_true(a["metrics"].get("holeNonWhiteResultRatio", 0) > 0.80, "non-white hole background should be diagnostic"),
                assert_true(a["suggestedScore"] >= 4, "hole background color should not hard-fail product preservation"),
                assert_true("hole_filled" not in a["tags"], "hole background color should not be tagged as filled"),
            ),
        )
    )

    ring_hole_filled = ring_source.copy()
    cv2.circle(ring_hole_filled, (128, 128), 24, (45, 90, 180), -1)
    cases.append(
        run_case(
            "ring_hole_filled_is_diagnostic",
            ring_source,
            ring_hole_filled,
            lambda a: (
                assert_true(a["metrics"].get("holeClosureScore", 0) > 0.45, "filled hole should stay diagnostic"),
                assert_true(a["suggestedScore"] >= 4, "filled hole alone should not be capped low"),
                assert_true("hole_filled" not in a["tags"], "filled hole alone should not be tagged"),
            ),
        )
    )

    solid_white_source = draw_solid_white_product(canvas())
    cases.append(
        run_case(
            "solid_white_product_no_hole",
            solid_white_source,
            solid_white_source.copy(),
            lambda a: (
                assert_true(a["status"] == "checked", "solid white product should be checked"),
                assert_true(
                    a["maskQuality"].get("holeAreaRatio", 0) == 0
                    or a["maskQuality"].get("holeConfidence") == "none",
                    "solid product should not expose a confident hole",
                ),
                assert_true(a["suggestedScore"] >= 4, "unchanged solid white product should stay high"),
            ),
        )
    )

    edge_shadow_only = source.copy()
    cv2.polylines(
        edge_shadow_only,
        [np.array([[74, 67], [173, 55], [194, 162], [94, 189]])],
        isClosed=True,
        color=(210, 210, 210),
        thickness=7,
    )
    edge_shadow_only = draw_product(edge_shadow_only)
    cases.append(
        run_case(
            "edge_shadow_only",
            source,
            edge_shadow_only,
            lambda a: (
                assert_true(a["suggestedScore"] >= 4, "edge-only change should not be capped low"),
                assert_true("silhouette_damage" not in a["tags"], "edge-only change should not hard-tag silhouette"),
            ),
        )
    )

    real_silhouette_damage = source.copy()
    cv2.rectangle(real_silhouette_damage, (78, 70), (122, 188), (255, 255, 255), -1)
    cases.append(
        run_case(
            "real_silhouette_damage",
            source,
            real_silhouette_damage,
            lambda a: (
                assert_true(a["suggestedScore"] <= 2, "real silhouette damage should score low"),
                assert_true(
                    "silhouette_damage" in a["tags"] or "product_changed" in a["tags"],
                    "real product damage should be hard-tagged",
                ),
            ),
        )
    )

    edge_threshold_regression = source.copy()
    cv2.polylines(
        edge_threshold_regression,
        [np.array([[76, 68], [172, 56], [192, 161], [95, 187]])],
        isClosed=True,
        color=(205, 205, 205),
        thickness=5,
    )
    edge_threshold_regression = draw_product(edge_threshold_regression)
    cases.append(
        run_case(
            "edge_threshold_regression",
            source,
            edge_threshold_regression,
            lambda a: assert_true(
                a["suggestedScore"] >= 4,
                "low material diff with contour edge change should not drop directly to 2",
            ),
        )
    )

    mild_structure_change = cv2.convertScaleAbs(source, alpha=1.0, beta=4)
    mild_case = run_case(
        "no_tag_low_score_guard",
        source,
        mild_structure_change,
        lambda a: (
            assert_true(
                not a["tags"] or a["suggestedScore"] >= 3,
                "items without hard tags should not score below 3",
            ),
            assert_true(
                "product_moved" not in a["tags"],
                "structure-only noise should not be tagged as movement",
            ),
        ),
    )
    cases.append(mild_case)

    visualization_analysis = analyze_pair(source, moved)
    overlays = write_visualizations(source, moved, visualization_analysis, SELFTEST_DIR / "overlays", "synthetic-moved")
    expected_overlay_keys = {"sourceMask", "materialMask", "holeMask", "resultMatch", "diffHeatmap"}
    assert_true(set(overlays) == expected_overlay_keys, "visualization should write all overlays")
    for path_value in overlays.values():
        path = ROOT_DIR / path_value
        assert_true(path.exists(), f"overlay missing: {path_value}")

    rows = [
        make_row(id="parallel-selftest-1"),
        make_row(id="parallel-selftest-2"),
        make_row(id="parallel-selftest-3"),
    ]
    serial_items = analyze_rows(rows, SELFTEST_DIR / "parallel-serial", False, 1)
    parallel_items = analyze_rows(rows, SELFTEST_DIR / "parallel-workers", False, 2)
    assert_true([item["itemId"] for item in serial_items] == [row["id"] for row in rows], "serial row order should be stable")
    assert_true(
        [item["itemId"] for item in parallel_items] == [row["id"] for row in rows],
        "parallel row order should be stable",
    )
    assert_true(len(parallel_items) == 3, "parallel product-check should return every item")

    payload = {
        "ok": True,
        "cases": cases,
        "overlays": overlays,
        "parallelItems": [item["itemId"] for item in parallel_items],
    }
    (SELFTEST_DIR / "results.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
