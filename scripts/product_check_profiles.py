from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
PROFILE_PATH = ROOT_DIR / "scripts" / "product_check_profiles.json"


def _profile_document() -> dict[str, Any]:
    return json.loads(PROFILE_PATH.read_text(encoding="utf-8"))


def canonical_profile_json(profile: dict[str, Any]) -> str:
    return json.dumps(profile, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def profile_digest(profile: dict[str, Any]) -> str:
    return f"sha256:{hashlib.sha256(canonical_profile_json(profile).encode('utf-8')).hexdigest()}"


def list_threshold_profiles() -> dict[str, Any]:
    document = _profile_document()
    profiles = document.get("profiles", {})
    return {
        "algorithmVersion": document["algorithmVersion"],
        "defaultProfileId": document["defaultProfileId"],
        "profiles": {
            profile_id: {
                "description": profile.get("description", ""),
                "digest": profile_digest(profile),
            }
            for profile_id, profile in profiles.items()
        },
    }


def load_threshold_profile(profile_id: str | None = None) -> dict[str, Any]:
    document = _profile_document()
    selected_id = profile_id or document["defaultProfileId"]
    profile = document.get("profiles", {}).get(selected_id)
    if profile is None:
        known = ", ".join(sorted(document.get("profiles", {}).keys()))
        raise ValueError(f"Unknown threshold profile: {selected_id}. Available profiles: {known}")

    return {
        "algorithmVersion": document["algorithmVersion"],
        "thresholdProfileId": selected_id,
        "thresholdProfileDigest": profile_digest(profile),
        "thresholdProfile": profile,
    }


DEFAULT_PROFILE_METADATA = load_threshold_profile()
