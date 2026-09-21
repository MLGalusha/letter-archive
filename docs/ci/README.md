# CI execution and release gates

CI runs on pull requests, pushes to main, and manual dispatch. Main and manual
runs retain full browser coverage. Pull requests use the conservative selection
policy below; quality and backend-connected smoke checks always run.

## Independent jobs

- `Tests, Typecheck, Build`: backend/frontend quality, contract synchronization,
  dependency audits, PostgreSQL regressions, lint, typecheck, and builds.
- `Mocked browser checks (shard-1)` through `(shard-4)`: the complete primary
  mocked suite partitioned by Playwright into four test-level shards. Each runner
  retains one worker and the existing Chromium/public-WebKit project membership.
- `Mocked browser checks (mobile)`: benchmark metadata tests once, then the
  complete mobile-layout suite with its existing two workers.
- `E2E Smoke`: backend-connected auth/navigation checks and database setup.
- `WebKit Native Scrolling`: macOS WebKit coverage.

The browser jobs do not consume quality artifacts, so they start after the small coverage-selection job while
quality runs independently. The manually dispatched full E2E suite retains its existing behavior.
Local `npm run test:mocked` is unchanged.

## Required result and production

`E2E Mocked Suite` is a stable aggregation check over the browser matrix. It runs
even after matrix failure. It requires successful selection, then either browser
`success` when selected or `skipped` when explicitly excluded. Failed, cancelled,
missing, or unexpected outcomes do not pass. Matrix fail-fast is disabled so a failure
in one shard does not discard the other shards' diagnostic results.

Existing branch-protection names remain unchanged. Production still requires
quality, the browser aggregate, smoke, and native WebKit. PR supersession,
production serialization, exact-SHA source verification, migration gates, and
stale-release protection are unchanged. A workflow change currently selects a
full production release; see [deployment](../deployment.md).

Each browser job uploads its own HTML report and JSON results, named by matrix
suite and run attempt. Diagnostic upload failures remain warnings; test failures
remain failures. No extra report-merging job is necessary to decide the gate.

## Measuring and validating changes

For a frozen source revision, list the unsharded primary suite and all four shards
using `playwright test --config=playwright.mocked.config.ts --list --reporter=json`
(with `--shard=1/4` etc. for shards). Compare the test identities, including browser
project: their union must equal the baseline, with no duplicates. Validate the
mobile suite separately. The count is derived from source, never a fixed quota.

Compare workflow elapsed time, individual job duration, queue delays, summed
runner time, test outcomes, retries, and skipped cases. More runners should lower
elapsed time but can increase setup cost. Historical observations are not a
controlled speedup guarantee. Preserve the same browser projects and assertions
when comparing execution strategies.

Official references: [Playwright sharding](https://playwright.dev/docs/test-sharding)
and [GitHub required checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).

## Conservative PR selection

`scripts/select-browser-checks.mjs` omits the mocked browser matrix and native
WebKit only when **every** changed file is an added/modified file in:

- `backend/src/**/*.ts`, excluding `backend/src/contracts/**`;
- `docs/**/*.md`.

Mocked suites start only the frontend and intercept API requests. Backend source
is not executed by these jobs. Backend-connected smoke, backend/frontend unit
tests, contract synchronization, builds, audits, and database regressions remain.
This exclusion does not establish that a backend change is safe: those checks
and the full main validation still provide the existing release gate.

Backend storage is deliberately excluded from this allowlist: mocked fixtures
read images there. Frontend, shared contracts, dependencies, browser fixtures,
workflow/configuration changes, and unknown paths run full coverage. Deletions,
renames, type changes, empty diffs, missing history, and revision mismatches also
run full coverage. Root Markdown files are intentionally not allowlisted.

The comparison is the PR base to GitHub's checked-out merge revision, covering
all commits in the PR. The decision, reason, and changed paths are printed in the
selection job; its summary records the reason and count. Selection regression
tests run before every decision. The aggregate rejects failed selection rather
than interpreting it as permission to skip. Main and manual runs always select
all browser jobs, so production dependencies cannot be intentionally skipped.

There is no dependency database, prediction model, or cached test result. UI
changes still run all browser projects and gain only the earlier sharding speedup.
To validate selection locally: `node --test scripts/select-browser-checks.test.mjs`.
