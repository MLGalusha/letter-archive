# Checkpoint — line-coordinate word ownership and transferable components

Date: 2026-08-08

## Critical superseding caveat — read the binding audit first

The sealed completed page is not a guaranteed one-mask-per-transcript-token target
set. A later audit found split words, combined adjacent words, and detached masks.
Every `HQ / 77` result below is therefore a geometry-binding proxy, not trustworthy
semantic word accuracy. Do not promote 56, 58, 64, 68, or 70/77. Read
[`BINDING-AUDIT-2026-08-08.md`](BINDING-AUDIT-2026-08-08.md) and complete its
many-to-many adjudication ledger before recomputing per-word metrics.

This checkpoint continues
`CHECKPOINT-2026-08-08-DISJOINT-COMPONENT-OWNERSHIP.md`. It records the
centerline-guided word-assignment experiments, a bounded-memory correction, a
sealed-evaluation binding failure, the corrected results, component-transfer
audits, and the acting-only interaction packets.

## Geometry-proxy conclusion retained for diagnosis

A fitted body centerline is a useful coordinate frame for word ownership. The
best tested page-007 configuration combines the transcript rough horizontal span
with line-local vertical support. Against the frozen transcript/global binding,
it improved high-quality selections from 56/77 to 58/77 while reducing foreign
human-word pixels from 54,117 to 44,987 and missed target pixels from 56,807 to
50,798. Missed-error words stayed at 11; Clean residual increased from 167,374 to
170,485 pixels. The acting auto-easy gate improved from 0.819672 to 0.859649 but
remains unsafe for automatic acceptance.

Do not promote a single cutter as truth. A frozen choice among four transcript
proposals had a sealed oracle ceiling of 61/77. With both locator families
re-evaluated against one canonical binding, eight-proposal choice reached 64/77.
One whole-component add/remove raised the oracle ceiling to 70/77. This is
proposal-set capacity, not acting-agent accuracy.

Component ownership should therefore be unique but locally transferable until a
line conflict is resolved. Irreversible reading-order knockout is unsafe: helpful
single-component transfers occurred in both directions.

## Evidence boundary

All acting candidates, cases, fits, and acting boards were written and hashed
before the completed page was opened. The completed page remained sealed from
acting agents. The current evaluator has seen sealed results and must not act on
the new packets.

The sealed page root is unchanged:

`/Users/masongalusha/Workspace/projects/letter-archive-word-envelope-shrink-wrap-poc/experiments/word-envelope-shrink-wrap-poc/artifacts/source-color-selector-v2/007-p02-next-iteration-reset-23c97df1a695-reset-ba7be47e2edc`

The acting-only packet run is physically separate:

`/Users/masongalusha/Workspace/projects/letter-archive-word-envelope-shrink-wrap-poc/experiments/word-envelope-shrink-wrap-poc/artifacts/line-choice-agent-packets-v1/007-p02-acting-only-disagreement8`

## Implementation

Primary implementation:

- `src/word_envelope/line_word_assignment.py`, SHA-256
  `9040c43a5bea1891f044c93eea9133a0f168416e84e24c6a69f688ab4cb4b130`;
- `scripts/experiment_line_coordinate_word_ownership.py`, SHA-256
  `e50064b4f6480dd2cfe05072bf60bfb840f6ae19d43de23389d5751527ba3895`;
- `tests/test_line_word_assignment.py`, SHA-256
  `b36f27c4d433bd94a11b35b103a08b2be40959003fa4a931e3e42aa73715b712`.

The module:

1. projects rough locators and connected Clean components into along-line `u`
   and perpendicular `v` coordinates;
2. assigns plausible components to a fitted line with explicit distance and
   ambiguity abstention;
3. proposes word intervals using the rough locator strip, locator midpoints, or
   low-ink valleys near those midpoints;
4. supports whole-component centroid assignment or boundary-crossing abstention;
5. preserves exclusive component ownership.

The first/last-line distance rule initially normalized a component by its
distance to other lines. That gave outer lines unbounded territory and absorbed
the page number and signature. The corrected implementation normalizes by actual
fitted-line separation at the component x coordinate. A regression test now
requires distant outer material to remain unsupported.

## Bounded run sequence

### V1 — incomplete memory failure

Root:

`artifacts/line-coordinate-word-ownership-v1/007-p02-body77`

`INCOMPLETE-RUN.md` SHA-256:
`c58e3cb261b8d19dfa9d01711d76863f9509dd6d992caab24666b0f616180a4f`

The script retained 1,232 full-page Boolean masks. After about 145 seconds the
process had reached approximately 1.9 GiB and was still climbing. It was stopped
before candidate freeze; no sealed page was opened and no result is comparable.
The correction stores component IDs and reconstructs one evaluation mask at a
time.

### V2 — bounded memory, invalid outer-line spacing

Root:

`artifacts/line-coordinate-word-ownership-v2/007-p02-body77-bounded-memory`

- candidate freeze: 164,629.223 ms;
- candidate-set SHA-256:
  `19a31c2dfce784a868e34743409837962f57800d1bda739da0c727da2cbb853b`;
- frozen acting file SHA-256:
  `b650fa922c4aded8a1954dfaf57d776af5253570f02a5dee8b58d94a1695ac23`;
- experiment identity SHA-256:
  `d2947510d3217d511c10ec1a65acc6301d1a8f9dc6ec703f84026ca67747eb4c`;
- experiment file SHA-256:
  `f5a98194752cd1ae3ab3cbd23c50dd26b4b8cac77d2ef33c56756fb7b92588dd`;
- acting board SHA-256:
  `4bbd0aaaf70b73461e3a0989adda4f778bb300a113ece21f6c5bb2e16f9450e5`;
- sealed board SHA-256:
  `649923b05395d2f20a21480b2aa53f884ae8dcf86fc53069d2b57cc9b4eb1365`.

The bounded evaluator stayed near 530 MiB. It exposed the outer-line absorption
bug: `many` could acquire the page number and `day-` could acquire the signature.
Preserve V2 as a failure example; do not compare it as the current method.

### V3 — spacing-fixed frozen sweep

Root:

`artifacts/line-coordinate-word-ownership-v3/007-p02-body77-spacing-fixed`

- candidate freeze: 155,725.782 ms;
- candidate-set SHA-256:
  `d4d9777c6c2d14fd8f792a2d729ceec24a42b8ac2cbfc20d2d68c27837542510`;
- frozen acting file SHA-256:
  `1a6158990dd367fcf137e3629a158d2b61be759c2455d2533a85aadaf4fc26ef`;
- experiment identity SHA-256:
  `ebb8d735d4d32bd97a42b2448af44e9c1b4652506997980e7d3ba143d875feee`;
- experiment file SHA-256:
  `ea30421d995e79751b664db72b5562b68c1a0825bd8edf1a728278a26f1bcfdd`;
- acting board SHA-256:
  `ec1dd97c074fc60ad75853c49ef64726e468511e5a25c68055ef01b83ce77657`;
- sealed board SHA-256:
  `1e02405ac7e3c196ece05071c741b6421d06de863dcde70c97d101166ceab2be`.

All configurations retained zero duplicate component claims.

| Locator | Method | HQ / 77 | Foreign-error words | Missed-error words | Foreign pixels | Missed pixels | Clean residual | Acting-gate precision |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| transcript | global exclusive | 56 | 16 | 11 | 54,117 | 56,807 | 167,374 | 0.819672 |
| transcript | line + rough span | **58** | **14** | **11** | **44,987** | **50,798** | 170,485 | **0.859649** |
| transcript | line + midpoint | 54 | 16 | 13 | 52,639 | 53,632 | 165,667 | 0.820000 |
| transcript | line + ink valley | 55 | 16 | 12 | 52,826 | 53,819 | 165,667 | 0.836364 |
| transcript | midpoint boundary abstain | 35 | 25 | 40 | 21,391 | 224,666 | 367,949 | 0.800000 |
| transcript | valley boundary abstain | 46 | 22 | 23 | 48,009 | 128,093 | 244,758 | 0.823529 |
| transcript | 3-of-4 consensus | 57 | 14 | 12 | 44,986 | 53,584 | 173,272 | 0.842105 |
| transcript | 4-of-4 consensus | 55 | 13 | 16 | 41,247 | 69,872 | 193,344 | 0.830508 |

Strict boundary abstention reduced foreign pixels but destroyed recall. It is an
optional review signal, not a default selector. Consensus also traded errors and
did not dominate line + rough span.

Examples from the sealed post-freeze board:

- `will`: global recall 0.001; line + rough span recall 0.985; midpoint recall
  1.000, all with precision 1.000;
- `write`: global precision 0.445; line + rough span precision 0.982 and recall
  1.000; midpoint reached 1.000/1.000;
- `answer.`: line + rough span and line + ink valley reached 1.000/1.000;
- `mean`: line + rough span stayed 1.000/1.000 while midpoint and valley
  truncated it;
- `Love`: every displayed whole-component proposal retained foreign ink;
- `it.`: the proposals were associated with the wrong line/instance, so better
  word cuts could not rescue ownership.

## Sealed binding failure and correction

The V3 experiment independently matched reviewed/Kraken and transcript locator
families to the completed partition. Eighteen unit IDs received different human
word numbers; across four reviewed configurations this produced 72 mismatch
receipts. Cross-family oracle comparisons and the original reviewed-family
headline are therefore invalid.

The invalid first oracle file is preserved:

- `choice-affordance-analysis.json`, file SHA-256
  `4aeb36096fc02eee1223119e5186f5ed4094eb1d67511c8281e1e1f57c756716`;
- invalid reported ceiling: 68/77.

The corrected sealed audit fixes every proposal to the human binding already used
by `transcript_bbox_xywh|global_exclusive` for the same unit ID:

- `canonical-binding-reevaluation.json`, analysis SHA-256
  `266f6c44007ed1458c9365c198dc9808690e77f1a915eac35927620a85aaa3f0`,
  file SHA-256
  `da4aa97a45122303533be86a2df909ebe93070a5a56e3f8325bcd145ab662c4b`.

| Reviewed/Kraken method | Original independently-bound HQ | Canonical-binding HQ | Canonical foreign pixels | Canonical missed pixels |
| --- | ---: | ---: | ---: | ---: |
| global exclusive | 41 | 37 | 76,153 | 124,336 |
| line + rough span | 52 | 49 | 54,887 | 95,243 |
| line + midpoint | 48 | 46 | 68,497 | 80,707 |
| line + ink valley | 57 | 55 | 59,910 | 72,120 |

The corrected eight-proposal oracle is 64/77: 56 baseline successes, five
additional transcript-method choices, three additional reviewed/Kraken choices,
and 13 words with no high-quality frozen proposal. The binding is now consistent,
but remains geometry-derived rather than independently text-labelled semantic
ground truth.

## Interaction-affordance audits

Scripts:

- `scripts/analyze_line_choice_affordances.py`, SHA-256
  `0242c63e6f2214836639bb1c9cff9119770819211ffb566ede786faf6b4764e9`;
- `scripts/analyze_one_toggle_affordances.py`, SHA-256
  `d27f5ccc0e39cccb4ebfb86f28b3dd33edc1ebc91d79255d85a48d0fc42412bc`;
- `scripts/reevaluate_line_candidates_canonical_binding.py`, SHA-256
  `245dd089673c943ca4088863012ab4dff77fc6f84a75aa6c42b917d72764edf7`;
- `scripts/analyze_exclusive_component_transfers.py`, SHA-256
  `c715facd35bfdd937f5ff3620b3e3237f1b1614bd9d50bcad4c6a0782c21b991`.

The transcript-only choice-plus-toggle audit is retained at
`transcript-one-toggle-affordance-analysis.json`, file SHA-256
`5e90f5e3c08e0abd0ec3c46bfa5d55236ac1fe58241a64943c91f9cf0e1c190e`:
61/77 choice-only and 67/77 with one whole-component toggle.

The corrected combined audit is
`canonical-both-one-toggle-affordance-analysis.json`, analysis SHA-256
`82af6c04dd628089828015788810d88bf208853eb8493ed891a3dd86f48aa14a`,
file SHA-256
`0d4703e84ddbd4148b9d65d8ad9c2aeb876fec15c93823edc51186a7a27d7ec5`:

- 64/77 choice-only;
- six additional words solvable with one component add/remove;
- 70/77 choice-plus-one-toggle oracle ceiling;
- unresolved: `Sure`, `how`, `much`, `you.`, `it.`, the later `I`, and the later
  `mean`.

Five of the six additional combined fixes remove a foreign component. The sixth
adds component 155 to `body-10-U03 I`. In the midpoint assignment, moving this
same component away from `body-10-U02 like` makes both words high-quality. This
motivates a local transfer action rather than independent word edits.

## Exclusive transfer and order audit

`exclusive-component-transfer-audit.json` has analysis SHA-256
`1a025f55a44b419a42c55c14b25f4afbd8b715594b0565f1e948b8a5fb09f247`
and file SHA-256
`8da3c852c636412c6b628a2e137b384f69138b152b84f4f4a629632a9e719995`.

One claimed whole Clean component was independently transferred to every other
word on its fitted line. A transfer was called non-regressing only when affected
high-quality count did not fall, foreign/missed/unlabelled pixels did not rise,
and at least one objective improved.

| Starting policy | HQ | Non-regressing transfers | Positive-HQ transfers | Best one-transfer HQ | Helpful to later | Helpful to earlier |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| global exclusive | 56 | 33 | 16 | 58 | 10 | 6 |
| line + rough span | 58 | 30 | 10 | 60 | 7 | 3 |
| line + midpoint | 54 | 42 | 20 | 56 | 14 | 6 |
| line + ink valley | 55 | 40 | 18 | 57 | 10 | 8 |

Examples include `write → will`, `Love → you.`, `guess → I`, `how → much`,
`like → I`, and `you → now`. The mixed directions reject a universal reading or
reverse order. A useful acting policy should keep components unique while local
neighbor conflicts remain transferable; commit irreversible knockout only after
the local line has been resolved or explicitly deferred.

## Acting-only agent packets

Builder:

`scripts/build_line_choice_agent_packets.py`, SHA-256
`4af96f77edb4d8ad008c626f4e4eb50ab970f237135d235cd959dfdd7d5e36ff`

Run manifest:

- root: `artifacts/line-choice-agent-packets-v1/007-p02-acting-only-disagreement8`;
- manifest identity SHA-256:
  `e1337c4183ee150a9db50b3749bf9208dcf2800b91d45fbeeb41e0cc01895ba8`;
- manifest file SHA-256:
  `e9eaa02426ee8e433821a13e44b1ed16ed8f6d3fdeb581ead3e45d093a70e4be`;
- cases: `body-08-U04`, `body-14-U02`, `body-13-U02`, `body-10-U03`,
  `body-09-U02`, `body-06-U05`, `body-04-U04`, `body-11-U04`.

Cases are ranked only by frozen software disagreement and then diversified by
line. Each packet contains original source context, the fitted line, transcript
and reviewed/Kraken rough boxes, numbered toggleable components, eight proposal
views, exact component lists and hashes, and a constrained response schema:
choose, choose plus add/remove component IDs, or defer. No completed-page data or
post-hoc failure labels are present.

All eight packets passed the structural boundary validator with zero violations.
The generator, canonical audit, transfer audit, manifest, and all eight work
packets reproduced byte-for-byte in a fresh temporary output.

The acting-model call is infrastructure-blocked:

- `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are absent;
- the installed `codex` command cannot find its native executable;
- Second Braincell reports missing local connection/auth configuration.

No acting response was fabricated and no evaluator response was applied.

## Verification

The following 20 relevant tests pass:

- six line-coordinate tests;
- eleven component-assignment/exclusivity tests;
- three acting-packet boundary tests.

All new scripts also pass bytecode compilation.

## Next bounded experiments

1. Connect an isolated acting-model route and run the eight packet decisions.
   Freeze raw responses, timings, parsed actions, and hashes before sealed scoring.
2. Score the agent at three levels: correct proposal choice; correct whole-component
   toggle/transfer; correct defer on split/reassignment cases. Do not collapse
   them into one IoU.
3. Build a local conflict graph per fitted line. Components may have one current
   owner, zero or more challenger words, and a provisional/committed state.
4. Test deterministic challenger ranking from locator overlap, line distance,
   neighbor exclusion, detached-mark scale, and bidirectional order stability.
   Freeze the ranking before evaluation.
5. Add a component-split representation for the seven unresolved cases. Compare
   numbered cut paths, two-point transverse cuts, and source-aligned negative
   scribbles; let the agent defer when whole-component ownership is insufficient.
6. Validate on held-out pages before promoting the page-007 line + rough-span
   configuration or any transfer heuristic.
