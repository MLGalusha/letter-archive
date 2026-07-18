# Metadata Ownership Rollout

Migration `0050_add_metadata_job_ownership.sql` is an expand-phase migration. It adds
a metadata revision and a revision-bound ownership tuple without guessing ownership
for a metadata attempt that was already running under an older application revision.
Use this runbook for deployment, legacy-attempt reconciliation, and the later strict
constraint contraction.

## Invariants During Expansion

- A current metadata owner is the complete tuple `metadata_run_id`,
  `metadata_run_revision`, `metadata_lease_expires_at`, `metadata_lease_run_id`,
  and `metadata_claim_kind`.
- Claims and renewals derive the five-minute lease deadline from PostgreSQL
  `clock_timestamp()`. Application clocks and the letter's general `updated_at` field
  are not part of metadata ownership.
- A complete tuple is valid only while `metadata_status = 'RUNNING'`, and its run
  revision must equal the letter's current `metadata_revision`; the lease run ID must
  equal the owner run ID. `QUEUED` intent recovers to `PENDING`, while `REQUESTED`
  replacement intent recovers to `FAILED` without replacing committed metadata.
- An entirely empty tuple remains valid in every status during expansion. In
  particular, this preserves a tokenless `RUNNING` attempt that began before the
  migration.
- A newly inserted `RUNNING` row or a new transition into `RUNNING` must include
  ownership. A pre-migration tokenless
  `RUNNING` attempt may still finish, but after another writer moves it to `FAILED`
  or another non-running state, its late `SUCCESS` write is rejected. The only direct
  non-running-to-`SUCCESS` transition is an authoritative human edit: it must clear
  the owner tuple, produce `EDITED` content, and increment the metadata revision by
  exactly one in the same write.
- `metadata_revision_nonnegative` and `metadata_owner_shape` are created `NOT VALID`.
  PostgreSQL therefore avoids an initial validation scan but still enforces them on
  inserted or updated rows. The migration intentionally performs no data backfill.

## Deployment Order

1. Apply migration 0050 before deploying ownership-aware application code.
2. Deploy the new API and worker revisions. Do not deliberately start new work on an
   older revision after the migration. Its tokenless transition into `RUNNING` will
   fail with SQLSTATE `23514` and constraint name
   `metadata_running_requires_owner`.
3. Let already-running old revisions drain. Their tokenless attempts are allowed to
   complete from `RUNNING`; this is the compatibility window, not evidence that they
   are current owned attempts.
4. Stop every old API and worker revision, including retrying one-off worker jobs.
   Wait beyond the longest possible in-flight metadata request and retry window.
5. Run the observation and reconciliation steps below. Do not contract the database
   constraint while an old executable can still write.

## Observe the Expansion State

The constraints should exist and remain unvalidated until the deliberate validation
step:

```sql
SELECT conname, convalidated
FROM pg_constraint
WHERE conrelid = 'letters'::regclass
  AND conname IN ('metadata_revision_nonnegative', 'metadata_owner_shape')
ORDER BY conname;
```

Inspect legacy attempts and any impossible partial tuple. `invalid_owner_shape` must
remain zero. `legacy_tokenless_running` may be nonzero only during the drain window.

```sql
SELECT
  count(*) FILTER (
    WHERE metadata_status = 'RUNNING'
      AND metadata_run_id IS NULL
      AND metadata_run_revision IS NULL
      AND metadata_lease_expires_at IS NULL
      AND metadata_lease_run_id IS NULL
      AND metadata_claim_kind IS NULL
  ) AS legacy_tokenless_running,
  count(*) FILTER (
    WHERE ((
      metadata_run_id IS NULL
      AND metadata_run_revision IS NULL
      AND metadata_lease_expires_at IS NULL
      AND metadata_lease_run_id IS NULL
      AND metadata_claim_kind IS NULL
    ) OR (
      metadata_status = 'RUNNING'
      AND metadata_run_id IS NOT NULL
      AND metadata_run_revision IS NOT NULL
      AND metadata_run_revision = metadata_revision
      AND metadata_lease_expires_at IS NOT NULL
      AND metadata_lease_run_id = metadata_run_id
      AND metadata_claim_kind IS NOT NULL
    )) IS NOT TRUE
  ) AS invalid_owner_shape,
  count(*) FILTER (WHERE metadata_revision < 0) AS negative_revisions
FROM letters;
```

Treat a nonzero invalid-shape or negative-revision count as a deployment blocker. Do
not repair it with a broad update; preserve the affected IDs and investigate the
writer that produced them.

## Current Lease Recovery

The API and worker run the shared serialized recovery coordinator at startup and every
60 seconds. It selects only fully bound tuples whose database-clock deadline has
expired. A queued first extraction returns to `PENDING`/`TRANSCRIBED` and receives a
new metadata revision; a requested regeneration becomes `FAILED`, restores the
workflow implied by the committed metadata content, and also advances the revision.
The configured API worker wake is level-triggered from durable queued transcription
or metadata work, and an exit-when-empty worker treats queued metadata leases as work
it can wait for and drain.

Heartbeat renewal, success, and producer failure require the exact run ID, exact bound
revision, matching lease-run ID, and a lease that is still live according to
PostgreSQL. Administrative cancellation requires the same exact owner but deliberately
does not require an unexpired deadline, so an operator can revoke an expired attempt
before the periodic coordinator sees it. Conditional updates ensure that concurrent
reconcilers or a racing heartbeat produce one authoritative winner.

Automatic recovery ignores tokenless legacy rows and malformed or mismatched tuples;
it never invents liveness evidence during the expansion window.

## Reconcile Drained Tokenless Attempts

Only run this transaction after all old executables are gone and their maximum
in-flight window has elapsed. It changes only legacy `RUNNING` rows whose whole owner
tuple is empty. Previously committed metadata content, review state, and publication
state are preserved, matching ordinary failed-attempt behavior.

```sql
BEGIN;

SET LOCAL lock_timeout = '5s';

UPDATE letters
SET metadata_status = 'FAILED',
    metadata_error = COALESCE(
      metadata_error,
      'Legacy metadata attempt reconciled after ownership rollout'
    ),
    workflow = CASE
      WHEN workflow = 'METADATA_EXTRACTING'
        THEN 'TRANSCRIBED'::workflow_state
      ELSE workflow
    END,
    updated_at = clock_timestamp()
WHERE metadata_status = 'RUNNING'
  AND metadata_run_id IS NULL
  AND metadata_run_revision IS NULL
  AND metadata_lease_expires_at IS NULL
  AND metadata_lease_run_id IS NULL
  AND metadata_claim_kind IS NULL
RETURNING id, metadata_status, workflow;

COMMIT;
```

Re-run the observation query. `legacy_tokenless_running`, `invalid_owner_shape`, and
`negative_revisions` must all be zero. If tokenless work reappears, an old executable
is still active; stop there rather than repeatedly reconciling it.

## Validate, Then Contract in a Later Migration

Once the observation query is clean, validate the expand-phase checks during a
controlled database window:

```sql
ALTER TABLE letters
  VALIDATE CONSTRAINT metadata_revision_nonnegative;
ALTER TABLE letters
  VALIDATE CONSTRAINT metadata_owner_shape;
```

Validation does not eliminate the temporary tokenless-`RUNNING` allowance. After the
old revision is permanently retired, use a separate tracked migration to add and
validate a strict shape under a temporary name:

```sql
ALTER TABLE letters
  ADD CONSTRAINT metadata_owner_shape_strict CHECK (
    (
      metadata_status = 'RUNNING'
      AND metadata_run_id IS NOT NULL
      AND metadata_run_revision IS NOT NULL
      AND metadata_run_revision = metadata_revision
      AND metadata_lease_expires_at IS NOT NULL
      AND metadata_lease_run_id = metadata_run_id
      AND metadata_claim_kind IS NOT NULL
    ) OR (
      metadata_status <> 'RUNNING'
      AND metadata_run_id IS NULL
      AND metadata_run_revision IS NULL
      AND metadata_lease_expires_at IS NULL
      AND metadata_lease_run_id IS NULL
      AND metadata_claim_kind IS NULL
    )
  ) NOT VALID;

ALTER TABLE letters
  VALIDATE CONSTRAINT metadata_owner_shape_strict;

ALTER TABLE letters
  DROP CONSTRAINT metadata_owner_shape;
ALTER TABLE letters
  RENAME CONSTRAINT metadata_owner_shape_strict TO metadata_owner_shape;
```

Use the repository's migration workflow for that SQL; do not paste it directly into a
production database without first verifying the application no longer depends on the
expand-phase allowance. The final constraint name matches the Drizzle schema.

Keep `metadata_status_transition_guard` until a later migration deliberately replaces
both of its guarantees: new runs require ownership, and `SUCCESS` cannot be resurrected
from `PENDING` or `FAILED`. Constraint validation alone does not encode transition
history.

## Failure and Rollback Notes

- A reconciliation lock timeout rolls back that transaction; inspect blockers and
  retry instead of removing the timeout.
- SQLSTATE `23514` with `metadata_owner_shape` indicates a partial, terminal, or
  revision-mismatched owner tuple. Fix the responsible writer rather than weakening
  the check.
- SQLSTATE `23514` with `metadata_running_requires_owner` means a new tokenless attempt
  tried to enter `RUNNING`; `metadata_running_owner_cannot_be_stripped` means a current
  owner was rebound or converted back to the legacy shape.
- SQLSTATE `23514` with `metadata_status_change_requires_revision` or
  `metadata_success_rewrite_requires_revision` normally indicates a stale legacy
  producer attempted to publish after authoritative work superseded it, or a current
  writer omitted the required revision advance.
- Do not drop the new columns as an application rollback. Stop ownership-aware work
  first and preserve the tuple for diagnosis. Returning to tokenless executors would
  require a separate reviewed rollback of the transition guard and must not overlap
  ownership-aware executors.
