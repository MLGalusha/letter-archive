# Agent-first ink-ownership workflow: development results

Status: development evidence snapshot from 2026-08-06. This is a proof of
concept, not a production accuracy report.

## Bottom line

The experiment supports the mechanics of an agent-first workflow: deterministic
software can prepare and bind visual evidence, expose reversible tools, regenerate
the state after a cleanup action, replay the decision, and create the final bubble.
It does **not** yet support automatic semantic acceptance or a claim that any model
can autonomously handle 99.9% of archive words.

The most useful observed division of labor is:

1. show a large context view, upright reading view, numbered connected components,
   a rough target box, and prior-owned ink in red;
2. keep hashes, exact component fingerprints, and prior ownership in deterministic
   software even when the agent sees only color;
3. let Terra handle routine words and reversible cleanup turns;
4. use Sol for difficult completion or an independent second opinion, but do not
   treat Sol as a correctness oracle; and
5. send disagreement, invalid/clipped inputs, and unresolved counterfactuals to a
   human until a held-out verifier is demonstrated.

The strongest positive result is the versioned cleanup loop: after five sealed-safe
Terra exclusions, the same Terra workflow made four pixel-exact claims on the next
turn, including fold-adjacent `Did` and vertical `We will`, and deferred `table`.
The strongest negative result is that a Sol review pass approved an unsafe `Seed`
erase, and a fresh Sol candidate critic retained all three false selections in a
six-claim review set. More pictures do not automatically create independent
semantic judgment.

This conclusion is provisional. V2 contains nine model-scored cases from three
pages; V3 adds ten deliberately messy cases but remains drawn from the same three
pages in Collections 007 and 014. The cases are highly correlated, and each
model/condition was run once. Luna was not available, so only Terra and Sol were
compared.

## What was tested

The target of the experiment is **ink ownership**, not polygon drawing. The agent
chooses one bounded action:

- claim all current components belonging to the target;
- exclude clearly foreign whole components and inspect another turn;
- cut one narrow extraction bridge and inspect another turn;
- request more bounded context; or
- defer for human review.

Deterministic software expands compact component IDs into hash-bound component
references, rejects stale actions, replays the action against the current mask,
and only then hands the selected ink to the existing shrink-wrap envelope code.

The strict benchmark gate requires all of the following for an evaluable claim:

- precision and recall of at least 0.995;
- no wholly missed target component and minimum per-target-component recall of at
  least 0.95;
- global semantic-neighbor contamination no greater than 0.005 and maximum
  contamination of any neighbor component no greater than 0.02;
- deterministic replay; and
- a claimed mask that is a subset of the extracted raw ink.

An input sealed as invalid is ineligible for a strict pass. Claiming it is a false
accept even if the visible fragment itself looks plausible.

## V1: discovery run, not a benchmark

V1 produced 20 Terra responses: ten context-only tasks and the same ten tasks with
prior-owned ink shown. The context-only run made three claims, six manual
deferrals, and one context request. The prior-owned run made three claims and seven
manual deferrals.

The useful discoveries were:

- both variants selected `I Love` and `Think` exactly;
- the context-only variant claimed only component 2 for `over`, omitting most of
  the word (the same selection later measured 0.548179872 recall in the V2
  scorer);
- the prior-owned variant claimed the visible `Seed` fragment even though the
  sealed input assessment marked the target crop clipped and invalid;
- hard cases generally caused safe abstention rather than aggressive selection;
- the prompt listed five action types but specified the exact JSON shape only for
  `claim_select`, so most nonclaim responses were not suitable for strict replay;
  and
- the `We will` pack violated a truth invariant: 422 semantic-neighbor pixels lay
  outside the current base mask.

Those contract and truth defects make V1 pass rates uninterpretable. V1 is retained
as evidence of why V2 needed compact action schemas, prompt hashing, fail-closed
validation, and truth-mask invariants.

## V2 design

V2 froze nine model-scored cases in randomized opaque order and generated three
variants per case, for 27 task packs:

| Variant | Agent sees red prior ink | Agent receives exact prior component refs |
|---|---:|---:|
| context-only (`-c`) | No | No |
| oracle-prior-red-only (`-r`) | Yes | No |
| oracle-prior-red-and-refs (`-s`) | Yes | Yes |

The word **oracle** is essential here. The red pixels and prior-component
references come from hand-authored semantic-neighbor truth, not from the output of
an earlier agent. These variants are upper-bound simulations of a sequential
workflow. They do not measure error propagation when an earlier word is assigned
incorrectly.

The nine cases cover routine separated words, detached punctuation, a sideways
`P.S.`, fold-adjacent `Did`, vertical text on Collection 014, a multiword vertical
`We will`, a heavily fragmented `gobbler`, and a clipped invalid `Seed` input. A
tenth fold-fragment case has no target transcript and is a software-router control:
it is sent directly to human review before model invocation and is not scored as a
model's ability to recognize a fold.

V2 also added:

- exact prompt path/copy/hash binding;
- compact ID-only decisions, with software filling all task hashes and component
  fingerprints;
- an upright reading-only image while preserving unrotated component coordinates;
- independent controls for showing red pixels and exposing their structured refs;
- a public-only staged directory, physically separated from private truth; and
- clipping semantic-neighbor truth to the current base mask, which removed the 422
  invalid pixels found in V1.

Five first-turn cohorts were run, producing 45 decisions. Every decision passed the
action schema and deterministic replay checks.

## First-turn results

| Agent / evidence | Claims | Evaluable claims | Strict passes | False accepts | Manual defers | Safe / unsafe nonterminal tools |
|---|---:|---:|---:|---:|---:|---:|
| Terra, context-only | 2 | 2 | 2 | 0 | 7 | 0 / 0 |
| Terra, oracle red only | 1 | 1 | 1 | 0 | 2 | 5 / 1 |
| Terra, oracle red + refs | 4 | 4 | 3 | 1 | 5 | 0 / 0 |
| Sol, oracle red only | 7 | 6 | 5 | 2 | 2 | 0 / 0 |
| Sol, oracle red + refs | 9 | 8 | 6 | 3 | 0 | 0 / 0 |

Across the 45 decisions, the agents made 23 terminal claims, 16 manual deferrals,
and six exclusions. The claims comprised 17 strict passes and six false accepts;
two of those false accepts were claims on the expected-invalid `Seed` input.

“False accept” includes claiming the expected-invalid `Seed` case. The summary
therefore must not be read as a conventional accuracy denominator. The evaluator's
`unnecessary_deferral` label also only means that sealed evaluable truth existed;
it does not prove that escalation was operationally wasteful.

### Terra observations

With context only, Terra made pixel-exact claims for `I Love` and `Think`, correctly
deferred the invalid `Seed`, and deferred the other hard cases.

With red pixels but no structured refs, Terra claimed only `I Love` on the first
turn. More importantly, it used the reversible `exclude` tool six times. Five
exclusions removed no target ink:

| Case | Removed target px | Removed neighbor px | Removed generic debris px |
|---|---:|---:|---:|
| `Did` | 0 | 2,093 | 0 |
| `over` | 0 | 78 | 5 |
| `Think` | 0 | 4,165 | 0 |
| `table` | 0 | 149 | 101 |
| `We will` | 0 | 989 | 0 |

The sixth exclusion, on invalid `Seed`, removed 57 target pixels and was correctly
classified by the sealed evaluator as an unsafe tool action. This is evidence that
red can be useful as a **workflow cue for reversible cleanup**, not evidence that
it improves first-turn completion by itself.

Adding structured refs let Terra claim `Did`, `I Love`, and `Think` exactly and
correctly defer invalid `Seed`. It also reintroduced an overconfident incomplete
claim for `over`: precision was 1.0, but recall was 0.548179872 and seven target
components were wholly missed.

### Sol observations

With red pixels and no structured refs, Sol made exact strict claims for `Did`,
`I Love`, `over`, `Think`, and vertical multiword `We will`. It deferred `P.S.` and
`table`. Its two false accepts were:

- invalid clipped `Seed`; and
- `gobbler`, with precision 1.0 but recall 0.965248227 and target components 32,
  34, 35, and 36 wholly missed.

The exact Sol selections for fold-adjacent `Did` and vertical `We will` have the
same pixel hashes as the existing hand-cleaned masks (`cf032f...` and `7c2285...`
respectively). Feeding those masks to the deterministic envelope stage produced the
already-saved fold and vertical bubble overlays. This verifies integration for
these two examples; it does not establish repeat reliability.

With red pixels and structured refs, Sol claimed all nine cases. It passed strictly
on `Did`, `I Love`, `P.S.`, `over`, `Think`, and `table`. The first five were
pixel-exact; `table` had recall 1.0 and precision 0.997161779, which remained above
the strict threshold. Its three false accepts were invalid `Seed`, the same
incomplete `gobbler` selection, and an incomplete `We will` claim with precision
1.0, recall 0.971484759, and components 23 and 24 wholly missed.

Structured refs increased first-turn autonomy, notably on `P.S.` and `table`, but
also made Sol claim every task and coincided with one additional incomplete claim.
Because there was only one run per condition, this is a warning signal rather than
a causal estimate.

## V3 messy expansion

V3 froze ten of the eleven stress cases not used as V2 model tasks and used the
provisionally preferred red-only evidence treatment. The remaining fold fragment is
the software-router control described above. Nine V3 tasks are evaluable and
`Cabbage` is a deliberately clipped invalid-input control. The set includes `would`,
`dropped`, `a few`, `letter`, `good`, `Come`, `big fat`, `with a`, and the
horizontal fold-crossing multiword `Love you`.

| Agent | Claims | Strict passes | False accepts | Manual defers | Correct invalid defers |
|---|---:|---:|---:|---:|---:|
| Terra red-only | 8 | 2 | 6 | 2 | 0 |
| Sol red-only | 6 | 3 | 3 | 4 | 1 |

Terra was pixel-exact on `letter` and `Love you`. Its other six claims were unsafe:
it claimed invalid `Cabbage`, over-selected `good` and `would`, and incompletely
selected `a few`, `Come`, and `with a`. Several bad claims were only medium
confidence, but the incomplete `a few` claim was high confidence.

Sol was pixel-exact on `a few`, `Come`, and `Love you`, correctly deferred invalid
`Cabbage`, and deferred `would`, `dropped`, and `big fat`. Its claims for `good`,
`letter`, and `with a` were unsafe over-selections; `with a` also wholly missed one
small target component. Sol therefore improved both completion and abstention over
Terra on this frozen set, but three of its six claims were still wrong. Notably,
Terra's exact `letter` selection became an over-selection when upgraded to Sol.

The agents made the exact same claim only on `Love you`, which was pixel-exact.
That single observation makes exact cross-model agreement worth testing on a much
larger holdout, but it is not evidence that agreement is sufficient for safety.

## Observable risk gate

The production-style risk gate does not receive target truth, neighbor truth, case
IDs, pilot tiers, or input-assessment labels. It uses the current mask, hash-valid
public task, replay-bound action, and observable features such as:

- plausible unselected components inside the active target box;
- selecting prior-owned components;
- border contact or a clipped-ink reason;
- claim confidence and claimed extent;
- orientation and multiword status;
- total/selected component count; and
- selection fragmentation; and
- whether a one-component add/remove counterfactual would also pass the same
  observable checks.

The first gate version looked promising in-sample, but an independent audit found
that it was one-sided. Exact `Did` was escalated because component 10 remained
unselected, while the incorrect selection `Did + component 10` was accepted despite
75 false-positive pixels and precision `0.984089945`. It also accepted `over` with
tiny target component 21 removed, despite recall `0.989293362`. The earlier
“accepted observed claims” counts are therefore retained only as discovery history,
not evidence of a safe acceptance rule.

The audit also found that the original internal-ref simulation changed a public
task without recomputing its pack hash. That path is now rejected. Internal prior
ownership has its own canonical verifier-state record, bound to task ID/hash, turn,
mask hash, inventory hash, exact component fingerprints, and an independent state
hash. The red-only task bytes remain unchanged.

Risk v2 adds one-component add/remove stability checks. On the explicit real
counterfactuals it escalates both incorrect candidates:

| Candidate | Precision | Recall | Risk v2 outcome |
|---|---:|---:|---|
| exact `Did` | 1.0 | 1.0 | escalate: plausible unclaimed ink |
| `Did` plus component 10 | 0.984089945 | 1.0 | escalate: locally ambiguous selection |
| exact `over` | 1.0 | 1.0 | escalate: locally ambiguous selection |
| `over` minus component 21 | 1.0 | 0.989293362 | escalate: locally ambiguous selection |

With a hash-bound internal prior state on V2 Sol red-only output, risk v2 accepted
only exact `I Love` and `Think`; it escalated all other claims, including both false
accepts and three exact claims. On the ten V3 messy tasks it accepted no Terra or
Sol result. This closes the observed counterexamples by abstaining aggressively; it
does not solve semantic verification. Thresholds were developed on these same
cases, so automatic acceptance remains disabled pending a sealed holdout.

The risk schema calls an uncertain otherwise-valid claim `escalate_sol`; manual,
context, border-contact, and clipped-input paths can emit `escalate_human` directly.
When `escalate_sol` is already produced after Sol, it also means **escalate to
human**, not “run Sol again.”

## Provisional routing and upgrade policy

The next experiment should use this conservative pipeline, with auto-acceptance
disabled:

1. **Software preflight.** Route missing transcripts directly to human review.
   Route known clipped targets, unbounded border contact, or invalid extraction
   state to context repair or human review before allowing a claim.
2. **Prepare agent evidence.** Supply large context, work crop, upright reading
   view, numbered components, an active target box, and prior-owned ink in red.
   Keep state hashes, full component fingerprints, and exact prior refs in software.
3. **Use Terra selectively.** Terra is suitable for routine horizontal words and
   reversible cleanup exploration. Route faint, fragmented, crowded vertical
   Collection 014 words directly to Sol or independent dual review; V3 showed that
   a Terra-first claim can create more unsafe work than it saves there.
4. **Version every cleanup.** Preview `exclude` or `cut` before commit, retain the
   parent state, replay only hash-bound actions, and regenerate component IDs after
   each accepted change. Do not rely on a model preview to detect an invalid crop.
5. **Preserve verifier independence.** Run Sol on the same clean task state when
   Terra is uncertain or the case is complex. Compare exact claimed masks in
   software before exposing either model's candidate to the other; the candidate
   critique experiment showed strong anchoring.
6. **Use risk as an escalation gate only.** Keep exact prior refs in a separately
   hash-bound internal verifier state. Any risk signal, model disagreement, invalid
   input, or nonterminal ambiguity goes to a human. Exact model agreement is only a
   promising queue-priority signal until a sealed holdout validates it.
7. **Generate the envelope deterministically.** The agent owns ink decisions; the
   existing geometry engine owns the final bubble.

This policy spends Sol and human attention on uncertainty while still extracting
useful reversible work from Terra. Thresholds and agreement rules must be frozen
and evaluated on a larger held-out set before any archive data is auto-accepted.

## Multi-turn cleanup result

The five target-safe Terra red-only exclusions were replayed into immutable child
tasks. Removed ink remained visible in red but became nonactionable; current
components were renumbered and rebound to the new mask. On turn 1, Terra made
pixel-exact claims for `Did`, `over`, `Think`, and vertical `We will`, and deferred
`table`. There were four strict passes and no false accept among these five branches.

This is conditional evidence: the evaluator used sealed target truth to decide
which exclusions were safe enough to progress. A production transition cannot make
that check. Terra's unsafe `Seed` exclusion was intentionally not progressed.

A fresh blind Sol pass on the same five child tasks claimed all five. It passed
strictly on four and falsely accepted `We will` by adding foreign ink (precision
`0.984511133`). Its `Did` and `table` claims passed the threshold but included 8 and
3 generic pixels respectively. Terra and Sol made the exact same claim only on
`over` and `Think`, both exact. The result is important: after a good cleanup turn,
Terra can outperform Sol on precision; “upgrade” must not mean “replace Terra's
answer with Sol's answer.”

## Candidate and version review result

The new public-only review tool renders a large context, upright candidate view,
numbered components, selected/unselected/prior-red overlay, and bounded
one-component add/remove previews. It also renders an exclusion before/after board
with the exact proposed removed ink in bright red. All review responses reuse the
same compact, replayable decision schema.

Three blind review experiments were negative:

- a Sol exclusion critic approved Terra's unsafe 57-pixel `Seed` removal;
- a fresh Sol candidate critic kept all six V3 Sol claims unchanged, preserving
  the three strict passes **and all three false accepts**; and
- a Terra candidate critic retained five candidates and removed component 24 from
  exact `Love you`, reducing recall to `0.744211687`; its six reviewed outputs
  contained two strict passes and four false accepts.

The review UI is mechanically useful and likely valuable for a human, but
candidate-aware model review was anchored to the proposed selection. The next model
experiment should collect independent selections first, compare them in software,
and expose a candidate only after disagreement has already forced review.

## Limitations and unresolved questions

- Nineteen scored cases from three pages are still far too small and correlated for
  a model capability or production accuracy estimate.
- Each agent/condition was sampled once. Stochastic variation, prompt sensitivity,
  and model-version drift are unknown.
- Luna was unavailable, so the requested Luna/Terra/Sol routing comparison is
  incomplete.
- Red and structured prior state are oracle simulations. A real sequential run can
  propagate earlier ownership mistakes; that failure mode was not measured.
- The safe multi-turn branch selector consults sealed truth and is an evaluator,
  not a production transition policy.
- Truth masks and several Collection 014 crops depend on hand-authored preprocessing
  cuts. The experiment evaluates ownership after that preprocessing, not whether an
  agent can reliably invent those cuts.
- Only exclusions were exercised as model-chosen nonterminal tools in V2 first
  turns. Agent-proposed cuts and expanded-context loops still need adversarial tests.
- The risk thresholds were developed and inspected on the same small corpus. Their
  conservative filtering behavior is not calibrated until reproduced on a sealed
  holdout.
- Candidate-review labels can obscure faint strokes, and both candidate-aware
  critics showed anchoring. Cleaner unlabeled comparison views and independent
  precommit judgments remain untested.
- Model revision, latency, token use, and raw response provenance were not exposed
  by the subagent runtime; the run folders bind decisions and actions but not a full
  reproducibility envelope for the model call.
- `Seed` tests abstention on a known invalid crop; it is not an ordinary evaluable
  word and must not be mixed into a standard accuracy denominator.
- The deterministic envelope was visually available for selected stress cases, but
  this pilot did not measure human review time, UI ergonomics, latency, cost, or
  collection-scale throughput.
- Hand-drawn/regenerated word fallback was not tested. It should remain a separate,
  explicitly reviewed experiment because it changes pixels rather than assigning
  ownership to source ink.

## Artifact map

- V1 corpus and prompt: `corpus/agent-ownership-pilot-v1.json`,
  `prompts/agent-ink-ownership-v1.md`
- V1 packs/responses: `artifacts/agent-ownership-pilot-v1/`
- V2 frozen corpus and prompt: `corpus/agent-ownership-pilot-v2.json`,
  `prompts/agent-ink-ownership-v2.md`
- V2 full packs with private truth: `artifacts/agent-ownership-pilot-v2/`
- V2 public-only staged packs: `artifacts/agent-ownership-pilot-v2-public/`
- All first-turn decisions, bound actions, evaluations, overlays, and risk reports:
  `artifacts/agent-ownership-pilot-v2-runs/`
- V2 Terra/Sol turn-1 follow-up packs and public stage:
  `artifacts/agent-ownership-pilot-v2-followups/` and
  `artifacts/agent-ownership-pilot-v2-followups-public/`
- Real add/remove risk counterfactual report:
  `artifacts/agent-ownership-counterfactual-v2/summary.json`
- V3 messy corpus, packs, public stage, and matched runs:
  `corpus/agent-ownership-pilot-v3.json`,
  `artifacts/agent-ownership-pilot-v3/`,
  `artifacts/agent-ownership-pilot-v3-public/`, and
  `artifacts/agent-ownership-pilot-v3-runs/`
- Hash-bound V3 internal verifier states:
  `artifacts/agent-ownership-pilot-v3-internal-verifier-states/`
- Exact truth-free Terra/Sol agreement reports:
  `artifacts/agent-ownership-pilot-v2-runs/agreements/` and
  `artifacts/agent-ownership-pilot-v3-runs/agreements/`
- Candidate and exclusion review packs:
  `artifacts/agent-ownership-pilot-v2-runs/terra-red/candidate-reviews/` and
  `artifacts/agent-ownership-pilot-v3-runs/sol-red/candidate-reviews/`
- Cohort-level exact counts: each cohort's `evaluation/summary.json` and
  `evaluation/index.json` below the runs directory
- `Did` deterministic envelope overlay:
  `artifacts/stress-real/007-p02-did/results/soft_union/overlay.png`
- `We will` deterministic envelope overlay:
  `artifacts/stress-real/014-p04-we-will/results/soft_union/overlay.png`
