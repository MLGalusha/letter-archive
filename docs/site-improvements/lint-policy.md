# Lint regression policy

`npm run lint` continues to show the complete existing diagnostic list. The codebase
is not lint-clean. CI runs `npm run lint:ci` and rejects increases for each
file/rule/severity combination relative to `frontend/eslint-baseline.json`.
New files therefore start with zero allowed diagnostics. Parsing failures always
fail. Reductions pass without requiring a baseline update.

Use `node scripts/check-lint.mjs --update-baseline` from frontend only after reviewing
every changed baseline entry. This is a count-based regression check: replacing an
old diagnostic with another under the same file/rule budget is not detected. It
complements code review, tests, and typechecking rather than proving hook correctness.

Remaining debt is mainly React hook/compiler diagnostics requiring individual
behavioral review. Do not silence whole rule families to make CI appear clean.
Underscore placeholders and intentionally omitted destructured rest fields follow
the repository's existing convention; genuinely unused ordinary names still fail.
