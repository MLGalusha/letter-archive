from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .paths import BACKEND_ROOT, REPOSITORY_ROOT


SAFE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class BenchmarkError(RuntimeError):
    def __init__(
        self,
        stage: str,
        code: str,
        message: str,
        details: Any | None = None,
    ) -> None:
        super().__init__(message)
        self.stage = stage
        self.code = code
        self.message = message
        self.details = details

    def as_dict(self) -> dict[str, Any]:
        value: dict[str, Any] = {
            "stage": self.stage,
            "code": self.code,
            "message": self.message,
        }
        if self.details is not None:
            value["details"] = json_safe(self.details)
        return value


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def generated_run_id(engine_id: str, scope: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    return f"{stamp}-{engine_id}-{scope}"


def ensure_safe_id(value: str, field: str = "id") -> str:
    if not SAFE_ID_RE.fullmatch(value):
        raise BenchmarkError(
            "arguments",
            "INVALID_ID",
            f"{field} must match {SAFE_ID_RE.pattern}",
            {"field": field, "value": value},
        )
    return value


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json_bytes(value: Any) -> bytes:
    return (
        json.dumps(
            json_safe(value),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
        + b"\n"
    )


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = (
        json.dumps(
            json_safe(value),
            ensure_ascii=False,
            sort_keys=True,
            indent=2,
            allow_nan=False,
        ).encode("utf-8")
        + b"\n"
    )
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    temporary.write_bytes(data)
    os.replace(temporary, path)


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise BenchmarkError(
            "configuration", "FILE_NOT_FOUND", f"Required file not found: {path}"
        ) from exc
    except json.JSONDecodeError as exc:
        raise BenchmarkError(
            "configuration",
            "INVALID_JSON",
            f"Invalid JSON in {path}: {exc}",
        ) from exc


def json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, bool)):
        return value
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            return None
        return value
    if isinstance(value, Path):
        return value.as_posix()
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_safe(item) for item in value]
    return str(value)


def run_capture(
    command: list[str],
    *,
    cwd: Path | None = None,
    timeout_seconds: int = 30,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    complete_env = os.environ.copy()
    if env:
        complete_env.update(env)
    return subprocess.run(
        command,
        cwd=str(cwd or BACKEND_ROOT),
        env=complete_env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout_seconds,
        check=False,
    )


def git_metadata() -> dict[str, Any]:
    commit = run_capture(
        ["git", "rev-parse", "HEAD"], cwd=REPOSITORY_ROOT, timeout_seconds=10
    )
    status = run_capture(
        ["git", "status", "--porcelain"], cwd=REPOSITORY_ROOT, timeout_seconds=10
    )
    return {
        "commit": commit.stdout.strip() if commit.returncode == 0 else "unknown",
        "dirty": status.returncode != 0 or bool(status.stdout.strip()),
    }


def host_metadata() -> dict[str, Any]:
    memory_bytes: int | None = None
    if platform.system() == "Darwin":
        result = run_capture(["sysctl", "-n", "hw.memsize"], timeout_seconds=5)
        if result.returncode == 0 and result.stdout.strip().isdigit():
            memory_bytes = int(result.stdout.strip())
    elif Path("/proc/meminfo").exists():
        match = re.search(
            r"^MemTotal:\s+(\d+)\s+kB$",
            Path("/proc/meminfo").read_text(encoding="utf-8"),
            re.MULTILINE,
        )
        if match:
            memory_bytes = int(match.group(1)) * 1024
    return {
        "os": platform.system(),
        "release": platform.release(),
        "arch": platform.machine(),
        "cpuCount": os.cpu_count() or 1,
        "memoryBytes": memory_bytes,
    }


def docker_metadata() -> dict[str, Any] | None:
    result = run_capture(
        [
            "docker",
            "info",
            "--format",
            "{{json .}}",
        ],
        timeout_seconds=20,
    )
    if result.returncode != 0:
        return None
    try:
        info = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None
    return {
        "clientVersion": _docker_client_version(),
        "serverVersion": info.get("ServerVersion"),
        "architecture": info.get("Architecture"),
        "cpuCount": info.get("NCPU"),
        "memoryBytes": info.get("MemTotal"),
    }


def _docker_client_version() -> str | None:
    result = run_capture(
        ["docker", "version", "--format", "{{.Client.Version}}"],
        timeout_seconds=10,
    )
    return result.stdout.strip() if result.returncode == 0 else None
