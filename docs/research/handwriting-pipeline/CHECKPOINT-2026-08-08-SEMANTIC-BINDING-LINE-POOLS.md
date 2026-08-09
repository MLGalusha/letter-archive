# Semantic binding and fitted-line component pools — durable checkpoint

Date: 2026-08-08

## Outcome

The page-007 body benchmark now has a sealed evaluator-only many-to-many
semantic ledger. It replaces every earlier forced one-mask-per-token binding.
Of 77 transcript units, 71 have exact scorable targets and 6 are deliberately
excluded because three completed masks each fuse two adjacent semantic words.

The user's fitted-line idea is supported, with an important distinction:

- use the line as a lane and along-line coordinate frame;
- use rough transcript and reviewed/Kraken boxes as anchors, not truth;
- use a staged component pool so missing ink can be recovered;
- keep exact component ownership as a separate agent or algorithm decision.

## Frozen semantic ledger

Output root in the sibling POC:

`artifacts/semantic-binding-adjudication-v1/007-p02-completed-evaluator-v1`

- decisions file SHA-256:
  `a76462ed16c37693ae2b04eaea11655bfac849c619bc80bd2d21964a3c82371b`;
- completed ledger file SHA-256:
  `3c9030c7aaa08c457bc24dfa76ff367429e20d51e6152c1c8776459468f26a5e`;
- adjudication identity SHA-256:
  `bdfd80d9eafe4568d192d4e426e5f5dd933123ebe4d77d84e0abd5c95bb62c97`;
- validation receipt SHA-256:
  `f3c43f41a808b2a888fa19aff7dc1e17f7ec8155ffcb1cf302c232f030562630`;
- validation: 77 declared masks, 74 assigned masks, 77 resolved masks,
  zero violations.

Split targets retained without forcing one-to-one binding:

- `Dolly` → H87 + H86;
- `you.` → H71 + H70;
- `any` → H56 + H55.

Merged targets excluded from exact word scoring:

- H73 spans `Sure` + `that`;
- H76 spans `how` + `much`;
- H52 spans `mean` + `it.`.

This is a first sealed visual adjudication, not an independent second-human
review. Do not expose the ledger, decisions, validation receipt, or evaluator
boards to an acting model.

## Trustworthy frozen-candidate reevaluation

Output:

`artifacts/semantic-binding-reevaluation-v1/007-p02-scorable71/reevaluation.json`

- file SHA-256:
  `70b8030a334e1557a678aab2ca7eb2fb4edec41406c30e47fb7158455916ac9b`;
- analysis SHA-256:
  `87a3d20c92c4def8e45a90bc481701d3dcf34f61f636bf08c133d98aa0100667`.

High quality still requires pixel precision ≥ 0.97 and recall ≥ 0.95. Foreign,
missed, and unlabelled pixels remain separate objectives.

| Frozen proposal | HQ / 71 | Foreign pixels | Missed pixels |
| --- | ---: | ---: | ---: |
| Transcript global exclusive | 55 | 44,299 | 46,265 |
| Transcript line + rough-span strip | **57** | **35,169** | **40,256** |
| Transcript line midpoint | 54 | 37,835 | 35,305 |
| Transcript line ink valley | 56 | 39,985 | 40,254 |
| Reviewed/Kraken global exclusive | 40 | 48,153 | 79,111 |
| Reviewed/Kraken line + rough-span strip | 52 | 26,887 | 50,018 |
| Reviewed/Kraken line midpoint | 47 | 35,998 | 44,564 |
| Reviewed/Kraken line ink valley | 56 | 29,051 | 40,537 |

The transcript line + rough-span method improves the baseline by three words
and regresses one, for a net 55→57/71. It also reduces both foreign and missed
pixels. This is the first trustworthy support for the fitted-line proposal.

Choosing among all eight frozen proposals reaches 65/71. One whole-component
toggle reaches 68/71. A second toggle adds zero. The three still unresolved are
`body-06-U02 you.`, `body-10-U04 do.`, and `body-10-U06 mean`.

## Missing-component diagnosis

The unresolved words do not require component splitting in the current Clean
layer. Their missing target ink lies in pure whole components absent from every
frozen proposal pool:

- `you.` lacks components 69 and 71;
- `do.` lacks component 155;
- `mean` lacks component 172.

This changes the next action from “give the agent more toggles” to “offer a
bounded recovery pool.”

## Acting-safe fitted-line pool expansion

Output root:

`artifacts/line-component-pool-expansion-v1/007-p02-scorable71`

Frozen acting-only pool set:

- identity SHA-256:
  `fb37b590a54803bf6608b9e81f172751483098e56ad157224bc680444e77965c`;
- file SHA-256:
  `c6b48709d543623c62ede95864ea1db4705ed4608f108639094f4841ca0072a3`.

Sealed evaluation:

- analysis SHA-256:
  `2ca2d687f6b54c53096a4f3a92d23f6187a1efaa8477a2f022ff909cc439eecc`;
- file SHA-256:
  `6b02b77e76b11c395a8a718a1c4b8f89756bacc8a1c32481c20ee2b5a071d096`.

The pool assigns Clean components to one fitted line, unions the transcript and
reviewed/Kraken rough boxes, then expands only the along-line interval. Pool
availability is not ownership accuracy.

| Along-line expansion | Complete target components / 71 | Median pool | P90 pool | Foreign/unlabelled pixels if everything were wrongly selected |
| ---: | ---: | ---: | ---: | ---: |
| 0% | 67 | 3 | 9 | 75,166 |
| 15% | 69 | 4 | 15 | 147,938 |
| 30% | 69 | 4 | 18 | 276,366 |
| 45% | **71** | 5 | 20 | 423,929 |
| 60% | 71 | 7 | 22 | 555,090 |
| 80% | 71 | 8 | 23 | 703,187 |

Recommended interpretation: start at 0–15%. Escalate to 45% only after defer,
low confidence, or an explicit missing-ink signal. Never select the expanded
pool wholesale. Expansion beyond 45% has no target-availability benefit here.

## Exclusive ownership order

Corrected transfer audit:

`artifacts/semantic-exclusive-component-transfer-v1/007-p02-scorable71/audit.json`

- analysis SHA-256:
  `27c8e13201bd9e359c339a1ed115b1b366995488a3715fe2247ef453a3014a96`;
- file SHA-256:
  `d0aa2fd577894fed3b1d58bdcd648e99aa3e66d6062f246a50b29d8b1cfd78cc`.

The audit requires a transfer to move a component toward the semantic target
that contains more of its pixels and to avoid regression in high-quality count,
foreign pixels, missed pixels, and unlabelled pixels. Beneficial transfers remain
mixed in direction:

- global: 3 earlier, 2 later;
- line strip: 2 earlier, 2 later;
- midpoint: 3 earlier, 4 later;
- valley: 3 earlier, 3 later.

Therefore unique ownership plus explicit transfer is supported, but a fixed
left-to-right or right-to-left processing order is not. Test confidence-first,
edge-inward, and bidirectional stability on held-out pages before choosing an
order policy.

## Next bounded experiments

1. Build acting-only staged-pool packets: compact 0–15% default and a separately
   requested 45% recovery view. Do not choose cases using sealed correctness.
2. Add a missing-ink/defer action that expands the pool without changing current
   ownership.
3. Run an isolated actor on the already-frozen eight packets when a model runtime
   is available; the local runtime remains unavailable.
4. Independently verify the semantic ledger, especially body-06 and body-10.
5. Repeat the binding and pool sweep on a held-out page before promoting 45% as a
   general recovery ceiling.
6. Compare confidence-first, edge-inward, left-to-right, right-to-left, and
   bidirectional-stability ordering with provisional exclusive claims and
   transfer receipts.
