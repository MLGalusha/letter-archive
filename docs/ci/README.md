# CI execution and release gates

CI runs on pull requests, pushes to main, and manual dispatch. All current checks
remain in the gate; this execution change does not select or omit affected tests.

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

The browser jobs do not consume quality artifacts, so they start alongside
quality. The manually dispatched full E2E suite retains its existing behavior.
Local `npm run test:mocked` is unchanged.

## Required result and production

`E2E Mocked Suite` is a stable aggregation check over the browser matrix. It runs
even after matrix failure and accepts only `success`; failed, cancelled, skipped,
or absent matrix outcomes do not pass. Matrix fail-fast is disabled so a failure
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

Test selection is a separate follow-up: first evaluate candidate exclusions
against full runs and known regressions. This workflow introduces no selection
policy or result cache.
