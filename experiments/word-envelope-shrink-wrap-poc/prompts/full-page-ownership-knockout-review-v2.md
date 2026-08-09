# Full-page ownership knockout review, pass 2

You are reviewing *candidate* ink ownership after the pass-1 word inventory.
This is a strict, page-complete adjudication pass.  It is not a transcription
pass, a geometry pass, or permission to silently improve a mask.

The input files are bound evidence.  Before making any decision, bind the
SHA-256 of the exact pass-1 decision file, the exact knockout manifest file,
and the exact residual-review-region manifest file (both its file and canonical
hashes).
The manifest's selection record is the source of the candidate mask path,
file hash, pixel hash, candidate pixel count, collision facts, and component
facts.  A colored board is a software visualization, not a semantic answer:
red is an exclusive candidate; orange is unassigned residual or withheld
collision ink.

For every line, in the supervisor's order, inspect all five views before
writing a decision:

1. The source crop.
2. The red/orange ownership board.
3. The exact candidate-mask subtraction view.
4. The background box-fill view.
5. The page coverage overlay.

Record that inspection in the line's `inspection_evidence`, copying the exact
relative path and current file hash for all five views.  This is a model
attestation only; the validator reopens and hashes every file.  Hashes, pixel
counts, collision status, and component status remain software facts.  Never
use an absolute, parent-traversing, or substituted evidence path.

For every pass-1 visible unit, exactly once, choose one action:

- `approve_candidate_mask` is permitted only for the byte/pixel-identical
  exclusive candidate mask supplied by the selection record.  It is forbidden
  for zero-pixel candidates, withheld collisions, any risk flag, any boundary
  or multi-box component, any `requires_agent_review` candidate, or any prior
  route other than routine `terra_box_mask`.  Never redraw, dilate, crop,
  combine, or substitute a mask while calling it an approval.
- `reopen_bbox` supplies a new in-bounds source rectangle, a reason, and a
  structured `regenerate_unit_candidate` follow-up.  It is a request for new
  candidate generation, never an ownership approval and never a dead end.
- `sol_review` is required for shared/touching, rotated, folded, fragmented,
  or otherwise non-routine ownership.  State the concrete question for Sol.
- `human_review` is for genuinely unreadable or unsafe cases.  State what a
  human must decide.

Review the software-built residual regions, not hundreds of loose components.
Every decision group must cite exact `source_region_ids`, and all regions and
all of their component IDs must be covered exactly once.  The validator also
relabels the exact residual PNG and checks the region/component partition
independently.  Legacy `excluded_components` are triage hints, not omissions:
border, outside-analysis, and sub-area-filter ink remain in the required
universe.  A narrowly bounded software-speck policy may cover only legacy
software-excluded components of at most three pixels; it is never evidence
that a larger or still-candidate residual is noise.

Terra must not terminally call a non-speck residual `non_text_artifact`.  Route
that semantic dismissal to Sol or a human.  A fragmented candidate containing
multiple connected components is also non-routine and cannot receive an exact
candidate-mask approval in this version.

Record visible missing-word candidates and detached target ink explicitly.
Both are `model_proposal_not_software_fact`; do not describe them as software
discoveries or production annotations.  Every missing word needs a stable
follow-up ID, evidence groups, target line, and either a create-unit action or
explicit Sol/human escalation.  A detached target-ink group must use the same
route as its reopening record and affected unit, contain the ink spatially,
and create the matching structured follow-up.

Finish the entire page before emitting the decision file.  A valid machine
decision is still **not production complete**.  The validator derives the
pending production reason from reopen/Sol/human work and refuses a claim of
production completion.
