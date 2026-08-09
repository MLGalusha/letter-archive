#!/usr/bin/env python3
"""Prove that an acting checkout is rooted in the sanitized research export.

This validator inspects Git metadata and tracked path names only. It never opens
historical artifacts or image contents.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SAFE_REPOSITORY = "github.com/MLGalusha/letter-archive-handwriting-acting-safe"
UNSAFE_REPOSITORY = re.compile(
    r"github\.com[/:]MLGalusha/letter-archive(?:\.git)?$", re.IGNORECASE
)
BOUNDARY_TAG = "acting-safe-root-2026-08-09"
POC_ARTIFACT_ROOT = "experiments/word-envelope-shrink-wrap-poc/artifacts/"
POC_CORPUS_ROOT = "experiments/word-envelope-shrink-wrap-poc/corpus/"
ROOT_SAFE_ARTIFACT_PREFIXES = (
    POC_ARTIFACT_ROOT
    + "best-ink-pipeline-cohort-v1/probabilities/012-18630108-L01-04/",
    POC_ARTIFACT_ROOT
    + "page-specific-local-ink-reference-v3/012-18630108-L01-04/top-left/",
    POC_ARTIFACT_ROOT + "kraken7-layout-page012-v1/012-18630108-L01-04/",
    POC_ARTIFACT_ROOT
    + "Kraken-stroke-adaptive-recovery-v3-m55/012-18630108-L01-04/top-left/",
    POC_ARTIFACT_ROOT
    + "eynollah-taught-group-ranking-v1/012-18630108-L01-04/top-left/",
)
FORBIDDEN_REACHABLE_PATH_MARKERS = (
    "semantic-binding-adjudication-v1",
    "sealed-line-technique-comparison",
    "adjudicated-ledger",
    "-binding-review.jpg",
    "completed-evaluator",
    "mixed_do_not_expose",
    "/007-p02-",
)


def git(*args: str, check: bool = True) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if check and result.returncode:
        raise RuntimeError(
            f"git {' '.join(args)} failed ({result.returncode}): {result.stderr.strip()}"
        )
    return result.stdout.strip()


def tree_paths(revision: str) -> list[str]:
    output = git("ls-tree", "-r", "--name-only", revision)
    return output.splitlines() if output else []


def reachable_paths() -> list[str]:
    paths: list[str] = []
    for line in git("rev-list", "--objects", "--all").splitlines():
        parts = line.split(" ", 1)
        if len(parts) == 2:
            paths.append(parts[1])
    return paths


def main() -> None:
    violations: list[dict[str, object]] = []
    roots = git("rev-list", "--max-parents=0", "--all").splitlines()
    if len(roots) != 1:
        violations.append(
            {"kind": "history_root_count", "expected": 1, "actual": len(roots)}
        )
    root = roots[0] if len(roots) == 1 else None

    tagged_root = git("rev-parse", "--verify", f"refs/tags/{BOUNDARY_TAG}^{{commit}}", check=False)
    if not tagged_root:
        violations.append({"kind": "missing_boundary_tag", "tag": BOUNDARY_TAG})
    elif root and tagged_root != root:
        violations.append(
            {
                "kind": "boundary_tag_not_history_root",
                "tag": BOUNDARY_TAG,
                "tagged_commit": tagged_root,
                "history_root": root,
            }
        )

    root_paths = tree_paths(root) if root else []
    unexpected_root_artifacts = sorted(
        path
        for path in root_paths
        if path.startswith(POC_ARTIFACT_ROOT)
        and not path.startswith(ROOT_SAFE_ARTIFACT_PREFIXES)
    )
    if unexpected_root_artifacts:
        violations.append(
            {
                "kind": "unexpected_root_artifact_paths",
                "count": len(unexpected_root_artifacts),
                "paths": unexpected_root_artifacts,
            }
        )
    root_corpus = sorted(path for path in root_paths if path.startswith(POC_CORPUS_ROOT))
    if root_corpus:
        violations.append(
            {"kind": "benchmark_corpus_in_root", "count": len(root_corpus), "paths": root_corpus}
        )

    all_reachable_paths = reachable_paths()
    forbidden = sorted(
        path
        for path in all_reachable_paths
        if any(marker in path for marker in FORBIDDEN_REACHABLE_PATH_MARKERS)
    )
    if forbidden:
        violations.append(
            {
                "kind": "forbidden_reachable_path_names",
                "count": len(forbidden),
                "paths": forbidden,
            }
        )

    remotes = git("remote", "-v", check=False).splitlines()
    remote_urls = sorted({line.split()[1] for line in remotes if len(line.split()) >= 2})
    unsafe_remotes = [url for url in remote_urls if UNSAFE_REPOSITORY.search(url)]
    if unsafe_remotes:
        violations.append({"kind": "unsafe_remote_configured", "urls": unsafe_remotes})
    if remote_urls and not any(SAFE_REPOSITORY in url for url in remote_urls):
        violations.append(
            {
                "kind": "acting_safe_remote_missing",
                "expected_fragment": SAFE_REPOSITORY,
                "urls": remote_urls,
            }
        )

    result = {
        "schema_version": "handwriting-acting-tree-validation.v1",
        "repository_root": str(REPO_ROOT),
        "head": git("rev-parse", "HEAD"),
        "history_root": root,
        "boundary_tag": BOUNDARY_TAG,
        "boundary_tag_commit": tagged_root or None,
        "history_root_count": len(roots),
        "current_tree_path_count": len(tree_paths("HEAD")),
        "root_tree_path_count": len(root_paths),
        "reachable_named_path_count": len(all_reachable_paths),
        "remote_urls": remote_urls,
        "sealed_contents_opened": False,
        "violation_count": len(violations),
        "violations": violations,
        "passed": not violations,
    }
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
