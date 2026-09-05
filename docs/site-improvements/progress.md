# Site improvements — September 2026

The implementation and measurement record is in [the full report](2026-09-05-site-improvements-report.md). It covers 17 focused PRs, their validation, measured improvements, delivery issues, and remaining follow-up.

Work began from origin/main at `11280b24` in the isolated `letter-archive-site-improvements` checkout. The original `rotated-region-recovery` checkout and its handwriting/research work remain excluded. No handwriting migration or research-runtime changes were imported.

Required tests, builds, typechecks, browser checks, and review resolution gate each merge. Production releases remain sequential and tied to the exact merged revision. [PR 76](https://github.com/MLGalusha/letter-archive/pull/76) is the final CI/reporting delivery gate.

Measured gains include about 61% fewer initial collection image requests and 67% less compressed collection-overview data for the same 24 items. Variable browser timings do not establish a consistent LCP improvement. Initial HTML metadata, larger-collection aggregation, existing lint debt, and editorial/support activation remain explicit follow-up items in the report.
