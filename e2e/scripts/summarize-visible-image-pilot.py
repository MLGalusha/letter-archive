"""Summarize local #123 evidence; no HTTP calls. Usage: python3 SCRIPT FIXTURE_OUTPUT.

Median uses statistics.median; p95 uses nearest rank ceil(n * .95) - 1.
Only w=480 image requests enter card timing/byte comparisons. Server rows join
by response x-request-id. Empty queue/transform samples mean no such phase was
logged, not a measured zero-duration operation. Keep excluded-* warmups separate.
"""
import hashlib
import json
import math
from collections import Counter
from pathlib import Path
import statistics
import sys
from urllib.parse import urlparse, parse_qs


def stats(values):
    values = sorted(values)
    return ({"n": len(values), "p50": round(statistics.median(values), 2),
             "p95": round(values[math.ceil(len(values) * .95) - 1], 2),
             "max": round(max(values), 2)} if values else None)


def completed_ms(request):
    value = request.get("timing", {}).get("responseEnd")
    return value if isinstance(value, (int, float)) and value >= 0 and not request.get("error") else None


directory = Path(sys.argv[1])
server = {row["id"]: row for row in map(json.loads, (directory / "server.jsonl").read_text().splitlines())}
result = {"method": "Median and nearest-rank p95; w=480 only; x-request-id server join; per-run observations, not independent field samples", "runs": [], "excludedRuns": []}
hash_sets, frontend_hashes = [], set()
for file in sorted(directory.glob("*/results.json")):
    raw = json.loads(file.read_text())
    images = [r for r in raw["requests"] if "/images/" in r["url"]]
    cards = [r for r in images if parse_qs(urlparse(r["url"]).query).get("w") == ["480"]]
    rows = [server[r["headers"]["x-request-id"]] for r in cards if r.get("headers", {}).get("x-request-id") in server]
    search = raw["searches"][0]
    card_hashes = {urlparse(r["url"]).path + "?" + urlparse(r["url"]).query: r.get("bodySha256") for r in cards}
    samples = {"browserMs": [completed_ms(r) for r in cards if completed_ms(r) is not None],
               "routeMs": [r["finished"] - r["started"] for r in rows]}
    for field in ["queueMs", "transformMs", "previewReadMs", "previewWriteMs"]:
        samples[field] = [r[field] for r in rows if field in r]
    summary = dict(raw["summary"])
    summary.pop("completedFirstVisibleWaitMs")
    entry = {"label": raw["label"], "engine": raw["engine"], "revision": raw["fixture"]["revision"],
             "workerPid": raw["fixture"]["workerPid"], "workerStarted": raw["fixture"]["workerStarted"],
             "imageRouteHash": raw["fixture"]["imageRouteHash"], "frontendHash": raw["fixture"]["frontendHash"],
             "backendLockHash": raw["fixture"]["backendLockHash"], "sources": raw["fixture"]["sources"],
             "imageRequests": len(images), "cardRequests": len(cards), "joinedCardServerRows": len(rows),
             "failedOrIncompleteCardRequests": sum(completed_ms(r) is None for r in cards),
             "cardBodyBytes": sum(r.get("bodyBytes", 0) for r in cards),
             "cardBodySetHash": hashlib.sha256(json.dumps(card_hashes, sort_keys=True).encode()).hexdigest(),
             "cardCache": dict(Counter(r.get("cache") for r in rows)),
             "imageStatuses": dict(Counter(r.get("status") for r in images)),
             "protocols": dict(Counter(r.get("protocol") for r in raw["priorities"] if r["event"] == "response")),
             "statistics": {name: stats(values) for name, values in samples.items()},
             "samples": {name: [round(v, 4) for v in values] for name, values in samples.items()},
             "searchActionToResultsMs": search["renderedEpochMs"] - search["startedEpochMs"],
             "imagesActiveAtSearchAction": sum(r["startedEpochMs"] <= search["startedEpochMs"] < r.get("finishedEpochMs", r.get("failedEpochMs", float("inf"))) for r in images),
             "searchRequestMs": [completed_ms(r) for r in raw["requests"] if "/letters/search" in r["url"] and completed_ms(r) is not None],
             "inputToNextFrameMs": [round(r["frameAt"] - r["at"], 2) for r in raw["ledger"]["inputs"]],
             "visible": summary, "pageErrors": raw["errors"],
             "requestErrors": [{"url": r["url"], "status": r.get("status"), "error": r.get("error")} for r in raw["requests"] if r.get("status", 0) >= 400 or r.get("error")],
             "bodyReadErrors": [r["bodyReadError"] for r in images if "bodyReadError" in r]}
    excluded = raw["label"].startswith("excluded-")
    result["excludedRuns" if excluded else "runs"].append(entry)
    if not excluded:
        hash_sets.append(card_hashes)
        frontend_hashes.add(raw["fixture"]["frontendHash"])
result["runs"].sort(key=lambda run: run["workerStarted"])
result["sameCardBodies"] = bool(hash_sets) and all(len(h) == 48 and None not in h.values() and h == hash_sets[0] for h in hash_sets)
result["sameFrontend"] = len(frontend_hashes) == 1
(directory / "summary.json").write_text(json.dumps(result, indent=2) + "\n")
for run in result["runs"]:
    print(run["label"], run["statistics"]["browserMs"], run["cardCache"], "visible wait", run["visible"]["visibleWaitMs"])
print("Same 48 card bodies:", result["sameCardBodies"], "same frontend:", result["sameFrontend"])
