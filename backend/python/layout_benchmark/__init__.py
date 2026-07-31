"""Reproducible document-layout benchmark runner.

This package is intentionally independent from the application database and
production line-segment services. It reads the tracked cohort manifest and
immutable source images, then writes only ignored benchmark artifacts.
"""

SCHEMA_VERSION = 1
RUNNER_VERSION = "1"
