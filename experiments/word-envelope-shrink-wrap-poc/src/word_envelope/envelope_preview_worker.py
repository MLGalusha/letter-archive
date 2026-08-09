"""Isolated deterministic worker for candidate-word envelope previews."""

from __future__ import annotations

import base64
from io import BytesIO
import json
import sys

import numpy as np
from PIL import Image

from .engine import EnvelopeError, EnvelopeParams, wrap_envelope
from .io_utils import canonical_json_bytes


def _line(value: dict) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8") + b"\n"


def _mask(request: dict, name: str) -> np.ndarray:
    encoded = request.get(f"{name}_png_base64")
    if isinstance(encoded, str):
        with Image.open(BytesIO(base64.b64decode(encoded, validate=True))) as image:
            return np.asarray(image.convert("L"), dtype=np.uint8) > 0
    with Image.open(request[f"{name}_path"]) as image:
        return np.asarray(image.convert("L"), dtype=np.uint8) > 0


def _run(request: dict) -> dict:
    selected = _mask(request, "selected")
    excluded = _mask(request, "excluded")
    if selected.shape != excluded.shape:
        raise ValueError("Selected and excluded masks have different dimensions")
    height, width = selected.shape
    successes = []
    failures = {}
    trials = []
    profiles = request.get("profiles")
    first_success_only = request.get("first_success_only") is True
    if not isinstance(profiles, list) or not profiles:
        raise ValueError("Envelope preview requires one or more named profiles")
    for profile in profiles:
        name = profile.get("name")
        if not isinstance(name, str) or not name:
            raise ValueError("Envelope profile name is invalid")
        params = EnvelopeParams.from_mapping(profile["params"])
        for method in ("morphological", "soft_union"):
            key = f"{name}/{method}"
            try:
                result = wrap_envelope(
                    selected,
                    params,
                    method=method,
                    excluded_mask=excluded,
                    rough_box=(0.0, 0.0, float(width), float(height)),
                )
                record = result.as_record()
                record["profile"] = name
                record["parameters"] = params.as_record()
                successes.append(record)
                trials.append({"profile": name, "method": method, "status": "pass"})
                if first_success_only:
                    return {
                        "successes": successes,
                        "failures": failures,
                        "trials": trials,
                    }
            except (EnvelopeError, MemoryError) as error:
                failures[key] = str(error)
                trials.append(
                    {
                        "profile": name,
                        "method": method,
                        "status": "rejected",
                        "reason": str(error),
                    }
                )
    return {"successes": successes, "failures": failures, "trials": trials}


def main() -> int:
    if "--persistent" in sys.argv[1:]:
        sys.stdout.buffer.write(_line({"ready": True}))
        sys.stdout.buffer.flush()
        for line in sys.stdin.buffer:
            try:
                response = {"ok": True, "result": _run(json.loads(line))}
            except Exception as error:
                response = {"ok": False, "error": str(error)}
            sys.stdout.buffer.write(_line(response))
            sys.stdout.buffer.flush()
        return 0
    try:
        request = json.loads(sys.stdin.buffer.read())
        sys.stdout.buffer.write(canonical_json_bytes(_run(request)))
        return 0
    except Exception as error:
        print(f"worker error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
