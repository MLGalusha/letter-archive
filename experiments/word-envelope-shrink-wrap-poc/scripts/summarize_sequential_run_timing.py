#!/usr/bin/env python3
"""Summarize per-word wall time and action counts from a sequential run."""

from __future__ import annotations

import argparse
import json
import statistics
from collections import Counter, defaultdict
from pathlib import Path


TERMINAL_ACTIONS = {"claim_select", "defer_tier", "defer_manual"}


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def summarize(run_dir: Path) -> dict:
    packets: dict[str, list[tuple[int, Path, dict]]] = defaultdict(list)
    for path in sorted((run_dir / "packets").glob("*/work-packet.json")):
        packet = _read(path)
        current = packet.get("current") or {}
        unit_id = current.get("unit_id")
        if unit_id:
            packets[unit_id].append((path.stat().st_mtime_ns, path, packet))

    events: dict[str, list[tuple[int, dict]]] = defaultdict(list)
    for path in sorted((run_dir / "commits").glob("*/event.json")):
        event = _read(path)
        unit_id = event.get("unit_id")
        if unit_id:
            events[unit_id].append((path.stat().st_mtime_ns, event))

    rows = []
    for unit_id, unit_packets in packets.items():
        unit_events = sorted(events.get(unit_id, []))
        terminal = None
        for event_mtime, event in unit_events:
            action_type = ((event.get("compact_action") or {}).get("action") or {}).get("type")
            if action_type in TERMINAL_ACTIONS:
                terminal = (event_mtime, event, action_type)
        first_packet = min(unit_packets, key=lambda item: item[0])
        first_current = first_packet[2]["current"]
        action_types = [
            (((event.get("compact_action") or {}).get("action") or {}).get("type") or "unknown")
            for _, event in unit_events
        ]
        row = {
            "unit_id": unit_id,
            "line_id": first_current.get("line_id"),
            "tentative_text": first_current.get("tentative_text"),
            "initial_tier": first_current.get("active_model_tier"),
            "packet_count": len(unit_packets),
            "action_count": len(unit_events),
            "action_types": action_types,
            "terminal": terminal is not None,
            "terminal_action": terminal[2] if terminal else None,
            "wall_seconds": round((terminal[0] - first_packet[0]) / 1_000_000_000, 3) if terminal else None,
        }
        rows.append(row)

    rows.sort(key=lambda row: min(item[0] for item in packets[row["unit_id"]]))
    completed = [row for row in rows if row["terminal"]]
    timings = [row["wall_seconds"] for row in completed]
    action_counts = Counter(action for row in completed for action in row["action_types"])
    return {
        "schema_version": "sequential-run-timing-summary.v1",
        "run_dir": str(run_dir.resolve()),
        "units_seen": len(rows),
        "units_terminal": len(completed),
        "timing": {
            "mean_seconds_per_terminal_unit": round(statistics.mean(timings), 3) if timings else None,
            "median_seconds_per_terminal_unit": round(statistics.median(timings), 3) if timings else None,
            "min_seconds": min(timings) if timings else None,
            "max_seconds": max(timings) if timings else None,
        },
        "action_counts": dict(sorted(action_counts.items())),
        "units": rows,
        "measurement_note": "Wall time uses first rendered packet mtime through terminal commit mtime; it includes model/tool latency and pauses.",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("run_dir", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = summarize(args.run_dir)
    encoded = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
    if args.output:
        args.output.write_text(encoded, encoding="utf-8")
    else:
        print(encoded, end="")


if __name__ == "__main__":
    main()
