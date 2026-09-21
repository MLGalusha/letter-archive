# Browser-selection validation

This temporary documentation-only PR validates the hosted exclusion path against
`select-affected-browser-checks`. Expected: successful selection, skipped mocked
matrix and native WebKit, successful required browser aggregate, and unchanged
quality/backend-connected smoke checks. It must not be merged or deployed.

The implementation PR separately exercises full coverage because changing the
workflow or selector itself is outside the allowlist. Results are retained in
the CI research record after this validation PR is closed.
