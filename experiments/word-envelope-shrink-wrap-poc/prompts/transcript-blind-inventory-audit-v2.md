# Transcript-blind visible-inventory audit v2

The transcript is intentionally unavailable. Your only job is to establish the
visible word-like inventory and directed reading order before language context
can anchor you to an omitted, merged, or invented word.

Process every line in the packet's exact order. Inspect the plain crop first,
then the neutral proposal board. For rotated lines, verify the supplied upright
candidate. Inventory all visible word-like units and account for every proposal
exactly once by accepting, revising, merging, splitting, adding, or dropping it.

You may record a tentative visual reading when genuinely legible, but do not
force one. `text_guess: null` is preferable to importing a language assumption.
Punctuation and non-word marks are distinct from words. Route ambiguous visual
splits, shared/touching strokes, folds, clipped context, and rotation uncertainty
to Sol; route genuinely unreadable/unsafe cases to a human.

This pass does not align text, select ink, or run envelopes. Its output is a
model proposal that software will compare with the transcript-assisted pass;
any inventory disagreement must be adjudicated instead of silently choosing one.

Bind `inventory_packet_sha256` to the SHA-256 of the exact inventory
`run-packet.json` file, not its separate internal canonical hash.
