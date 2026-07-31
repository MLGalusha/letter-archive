from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from .engines import ENGINE_IDS
from .runner import (
    check_comparable,
    list_pages,
    preflight_engines,
    run_benchmark,
    setup_engines,
)
from .util import BenchmarkError


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="layout-benchmark",
        description="Run immutable, database-independent layout benchmarks.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run", help="Run one or all engines")
    _engine_argument(run_parser, allow_all=True)
    run_parser.add_argument(
        "--scope", choices=("smoke", "full"), default="smoke"
    )
    run_parser.add_argument(
        "--page",
        action="append",
        default=[],
        help="Canonical page key; repeat for multiple explicit pages.",
    )
    run_parser.add_argument("--run-id")

    preflight_parser = subparsers.add_parser(
        "preflight", help="Verify engine versions, models, and resources"
    )
    _engine_argument(preflight_parser, allow_all=True)

    setup_parser = subparsers.add_parser(
        "setup", help="Create a pinned isolated engine runtime"
    )
    _engine_argument(setup_parser, allow_all=True)

    pages_parser = subparsers.add_parser(
        "list-pages", help="Print the fixed page selection"
    )
    pages_parser.add_argument(
        "--scope", choices=("smoke", "full"), default="smoke"
    )

    compare_parser = subparsers.add_parser(
        "check-comparable",
        help="Reject paired runs with different prepared pixels or selection",
    )
    compare_parser.add_argument(
        "--run", action="append", required=True, dest="run_ids"
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    try:
        value, success = _execute(args)
        print(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2))
        raise SystemExit(0 if success else 2)
    except BenchmarkError as exc:
        print(
            json.dumps(
                {"ok": False, "error": exc.as_dict()},
                ensure_ascii=False,
                sort_keys=True,
                indent=2,
            ),
            file=sys.stderr,
        )
        raise SystemExit(2) from exc


def _execute(args: argparse.Namespace) -> tuple[dict[str, Any], bool]:
    if args.command == "list-pages":
        return list_pages(args.scope), True
    if args.command == "check-comparable":
        result = check_comparable(args.run_ids)
        return result, bool(result["comparable"])
    engines = _engine_ids(args.engine)
    if args.command == "preflight":
        result = preflight_engines(engines)
        return result, bool(result["ready"])
    if args.command == "setup":
        result = setup_engines(engines)
        return result, bool(result["ready"])
    if args.command == "run":
        results: list[dict[str, Any]] = []
        for engine_id in engines:
            run_id = args.run_id
            if run_id is not None and len(engines) > 1:
                run_id = f"{run_id}-{engine_id}"
            results.append(
                run_benchmark(
                    engine_id=engine_id,
                    scope=args.scope,
                    explicit_page_keys=args.page,
                    requested_run_id=run_id,
                )
            )
        value = {
            "ok": all(item["state"] == "completed" for item in results),
            "runs": results,
        }
        return value, bool(value["ok"])
    raise BenchmarkError(
        "arguments", "UNKNOWN_COMMAND", f"Unknown command {args.command}"
    )


def _engine_argument(
    parser: argparse.ArgumentParser, *, allow_all: bool
) -> None:
    choices = (*ENGINE_IDS, "all") if allow_all else ENGINE_IDS
    parser.add_argument("--engine", choices=choices, required=True)


def _engine_ids(value: str) -> tuple[str, ...]:
    return ENGINE_IDS if value == "all" else (value,)


if __name__ == "__main__":
    main()
