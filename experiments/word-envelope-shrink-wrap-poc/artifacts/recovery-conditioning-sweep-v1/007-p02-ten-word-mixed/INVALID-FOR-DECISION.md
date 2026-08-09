# Invalid for workflow decisions

This immutable run correctly froze its local recovery candidates, hashes, and
timings, but its interpretation excluded conditioning-anchor pixels from the
"optional recovered evidence" count. Some of those anchor pixels were outside
the fixed ownership mask. That accidentally conflated recovery conditioning
with ownership and understated the selectable evidence introduced by larger
conditioning boxes.

Preserve this run as a wiring-failure example. Do not compare or promote its
target/foreign recovery summaries. The corrected successor treats every
candidate pixel outside the unchanged ownership mask as optional evidence,
regardless of whether it came from Clean anchor ink or local source recovery.
