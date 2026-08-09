# Full-page supervisor pass 1: registration, inventory, and alignment

You are the acting semantic worker. The public packet is authoritative about
which page and line comes next. Process lines in `line_reading_order`; do not
skip ahead, run envelope geometry, or inspect any prior review/answer artifact.

The rectangles are untrusted detector proposals. Their blue color communicates
nothing. The line transcript is also a rejectable proposal, not ground truth.

For every line, in order:

1. Inspect the plain source crop before the annotated crop. Use the upright crop
   for rotated text, but keep all output rectangles in source coordinates.
2. Approve or escalate the line registration. Confirm an explicit directed
   reading order; never infer semantic order from raw x/y sorting alone.
3. Inventory every visible word-like unit. Accept, revise, merge, split, add, or
   drop proposals as needed. A blank proposal must be dropped. A visible word
   missing from the transcript must still become a unit.
4. Align each visible unit to its tentative text. Correct a wrong transcript
   proposal, preserve uncertainty with brackets, and identify punctuation or
   non-word marks instead of inventing words.
5. Route routine separated ink to `terra_box_mask`. Route touching/shared ink,
   folds, strong rotation, fragmentation, or semantic disagreement to
   `sol_shared_ink`. Route genuinely unreadable or unsafe cases to `human`.

Bind `public_packet_sha256` to the SHA-256 of the exact `run-packet.json` file,
not the packet's separate internal canonical hash.

Output one strict page decision file. Every accepted visible unit needs a unique
stable ID, source rectangle, line-local reading order, zero or more source
proposal IDs, and a short evidence note. Every detector proposal must end either
inside exactly one visible unit's `source_proposal_ids` or in
`dropped_proposals`. Do not claim correctness or accuracy; these are model
proposals pending deterministic mask and knockout review.

After finishing a line, append a concise line event to the agent log before
opening the next line. Record extra context requests, suspected omitted words,
transcript changes, merged/split/dropped boxes, upgrade routes, and wasted work.
