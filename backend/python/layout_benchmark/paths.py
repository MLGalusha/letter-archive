import os
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parent
PYTHON_ROOT = PACKAGE_ROOT.parent
BACKEND_ROOT = PYTHON_ROOT.parent
REPOSITORY_ROOT = BACKEND_ROOT.parent

COHORT_PATH = BACKEND_ROOT / "benchmarks" / "layout" / "cohort.v1.json"
CONFIG_ROOT = BACKEND_ROOT / "benchmarks" / "layout" / "engine-configs"
PREPROCESSING_CONFIG_PATH = CONFIG_ROOT / "shared-preprocessing.v1.json"
SMOKE_CONFIG_PATH = CONFIG_ROOT / "smoke.v1.json"
RUNS_ROOT = BACKEND_ROOT / "test-results" / "layout-benchmark" / "runs"
STORAGE_ROOT = BACKEND_ROOT / "storage" / "collections"
RUNTIME_ROOT = PACKAGE_ROOT / ".runtime"


def backend_relative(path: Path) -> str:
    """Return a POSIX path relative to backend, rejecting paths outside it."""
    return path.resolve().relative_to(BACKEND_ROOT.resolve()).as_posix()


def resolve_backend_relative(value: str) -> Path:
    """Resolve a config path under backend without permitting traversal."""
    if Path(value).is_absolute():
        raise ValueError("Backend-relative path cannot be absolute")
    # Check the lexical path rather than following symlinks. Python virtual
    # environment executables are symlinks to framework interpreters outside
    # the repository, but the configured entry point itself remains scoped
    # beneath backend.
    candidate = Path(os.path.abspath(BACKEND_ROOT / value))
    candidate.relative_to(BACKEND_ROOT.absolute())
    return candidate
