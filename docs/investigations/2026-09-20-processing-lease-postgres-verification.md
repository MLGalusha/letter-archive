# Processing lease PostgreSQL verification

Issue: [#192](https://github.com/MLGalusha/letter-archive/issues/192)

The required `Tests, Typecheck, Build` job now runs both the existing migration/race harness and a direct production-function PostgreSQL suite. No production behavior or branch-protection settings changed.

## Direct suite

Run `npm run test:processing-leases:postgres` from `backend/`, with Docker available. Normal `npm test` skips this opt-in suite.

The test creates a named disposable PostgreSQL 16 container on an ephemeral loopback port, applies the actual migration journal, and imports production job functions only after pointing their database pool at that fixture. It never uses the developer's database URL. Database statements/locks, subprocesses, synchronization, and test execution have deadlines; teardown closes all pools and removes the container.

Coverage:

- Exclusive transcription, metadata, entity, and extra-content claims, with two distinct production sessions observed waiting on the same locked row before release.
- Transcription primary-source and owner fences; metadata revision, owner, and source-invalidation fences; extra-content source and successor-owner fences.
- Concurrent queued and requested expiry recovery for transcription, metadata, and extra content. Each race returns its exact letter once, preserves committed content, and clears the complete ownership tuple.
- Expired and superseded producer writes cannot replace recovered state or successor results. A live extra-content successor also retains its entire row when its cancelled predecessor finishes.
- Live leases remain untouched by recovery. Claim/renewal deadlines use database time even with a deliberately incorrect application clock.

The existing harness additionally covers worker execution ownership, entity liveness and both publication/recovery interleavings, transcript guidance, page/correspondence source boundaries, and legacy migration 0051/0053/0054 upgrade cases.

## Local evidence

- Direct production-function suite: **15 tests passed**; final run 4.97 seconds, including migrations and teardown.
- `npm run db:test-migrations`: passed all fresh/legacy migration and SQL/race fixtures.
- `npm run typecheck`: passed.
- `npm test`: **1,393 tests passed**; opt-in PostgreSQL suites skipped as intended.
- `git diff --check`: passed.

Remote CI and independent review remain separate checks before this branch is ready for approval. This work does not merge, deploy, or modify production data.
