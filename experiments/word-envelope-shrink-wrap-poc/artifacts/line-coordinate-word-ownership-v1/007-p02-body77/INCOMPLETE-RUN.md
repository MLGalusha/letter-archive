# Incomplete run — no decision evidence

Date: 2026-08-08

This run was terminated before `frozen-acting-candidates.json` existed and before
the sealed human run was opened. It is invalid for all comparisons.

Cause: the first experiment implementation retained one full-page Boolean mask for
every word/configuration while fitting 1,232 candidates. Memory pressure rose to
approximately 23% of system memory after 145 seconds. The corrected implementation
stores component identities and hashes, then reconstructs one mask at a time for
post-freeze evaluation.

No candidate set, metric, or sealed evaluation was produced here.
