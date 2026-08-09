# Binding audit — completed-page masks are not one-to-one semantic word truth

Date: 2026-08-08

This audit supersedes semantic interpretation of every page-007 `HQ / 77` count
that used an automatic one-to-one match between the 77 acting body units and the
100 masks in the completed selector run. The acting candidates remain valid and
frozen; the sealed word-level scoring target does not.

## Decision

Do not promote 56/77, 58/77, 64/77, 68/77, or 70/77 as semantic word-ownership
accuracy. They are geometry-binding proxy results produced by different invalid or
unadjudicated one-to-one mappings.

Status update: a first sealed many-to-many evaluator ledger is now complete and
strictly validated. It yields 71 exactly scorable units and excludes 6 units
covered by three merged masks. Trustworthy 71-unit results and fitted-line pool
experiments are recorded in
[`CHECKPOINT-2026-08-08-SEMANTIC-BINDING-LINE-POOLS.md`](CHECKPOINT-2026-08-08-SEMANTIC-BINDING-LINE-POOLS.md).
The quarantined 77-unit proxy counts remain invalid.

The completed page remains excellent evidence for:

- disjoint selected ink;
- page-level claimed and residual pixels;
- selection geometry and interaction history;
- candidate semantic binding review.

It was not exact per-transcript-token ground truth: the 100 committed masks do not
guarantee one mask per semantic word. Visual review shows split words, combined
adjacent words, and detached masks. The completed ledger now represents those
exceptions explicitly; an independent second-human check remains recommended.

## Frozen inputs

- Acting experiment:
  `artifacts/line-coordinate-word-ownership-v3/007-p02-body77-spacing-fixed/experiment.json`,
  file SHA-256
  `ea30421d995e79751b664db72b5562b68c1a0825bd8edf1a728278a26f1bcfdd`,
  experiment SHA-256
  `ebb8d735d4d32bd97a42b2448af44e9c1b4652506997980e7d3ba143d875feee`.
- Completed page:
  `artifacts/source-color-selector-v2/007-p02-next-iteration-reset-23c97df1a695-reset-ba7be47e2edc`,
  revision 103, 100 masks.
- Acting centerlines:
  `artifacts/component-line-field-cross-dispute-v2/007-p02-body77-min50/acting-centerlines.json`,
  file SHA-256
  `c4ecb680941048900562e4a4090761398536a40701fc36a67f371ee8578ba474`.

All paths above are relative to the sibling POC root unless absolute.

## How the failure was found

The first V3 evaluator called `bind_human_numbers` separately for each locator
family. It used unrestricted Hungarian geometry matching from 77 units to all 100
completed masks. Eighteen unit IDs received different target numbers between
reviewed/Kraken and transcript locators. Across four reviewed configurations this
created 72 mismatch receipts.

Reusing the transcript/global match for every family removed cross-family target
switching, but did not establish semantic truth. The unresolved-case audit found
targets physically far from their named units:

- `Sure` rough box `[1157,877,189,111]` was scored against a component at
  `[672,729,163,165]`;
- `how` near y≈1040 was scored against a component near y≈1202;
- `you.` near x≈859/y≈1258 was scored against a component near x≈431/y≈1140;
- the later line-10 `I` near y≈1875 was scored against a component near y≈1565.

These are binding failures, not word-ownership failures.

## Failed binding hypotheses retained

### 1. Independent unrestricted Hungarian binding

This produced the attractive original proxy counts:

- transcript global exclusive: 56/77;
- transcript line + rough span: 58/77;
- reviewed/Kraken line + ink valley: 57/77;
- first combined choice oracle: 68/77.

It is invalid for semantic comparison because locator families can change the
sealed target being measured.

### 2. Transcript/global canonical binding

Record:

`artifacts/line-coordinate-word-ownership-v3/007-p02-body77-spacing-fixed/canonical-binding-reevaluation.json`

Analysis SHA-256:
`266f6c44007ed1458c9365c198dc9808690e77f1a915eac35927620a85aaa3f0`.

It fixed one target number per unit across every proposal family and corrected the
combined proxy choice ceiling to 64/77. A one-component proxy audit reached 70/77.
The physical outliers above prove that this binding is still not semantic truth.
Treat the choice, toggle, and transfer audits as interaction-capacity diagnostics
only.

### 3. Contiguous mask-number reading order

Script SHA-256:
`c3c752033bf15889eb78633fb67c164e6169c48e1f263e46118d9116e0b184a9`.

Record:

`reading-order-binding-reevaluation.json`, analysis SHA-256
`f714c75da4fc423f7ca2b1b2c38137194eb529082f528574db30776f42c59d64`,
file SHA-256
`c4d838e9ec03693fcd18b050a454e08b5df10e6e1eb4a4d27a1a286d5ce1bb45`.

Among 48 contiguous 77-mask/orientation hypotheses, mask numbers 99→23 won with
geometry cost `-127.073516965`; the runner-up 98→22 cost `-23.418254478`, a
margin of `103.655262487`. This is strong evidence that masks 23–99 are the body
set. It is not evidence that their numbers are exact reading order. Three lines
failed left-to-right monotonicity. The resulting 41/77 baseline and 43/77 midpoint
counts are invalid for promotion.

### 4. Capacity-constrained fitted-line binding

Script SHA-256:
`7c2f4cfc585bcd9f37e96f385ae0f4329aa39909824dba3739c9fc7ec9ba6b4f`.

Record:

`capacity-line-binding-reevaluation.json`, analysis SHA-256
`fa1fa4afdd7324c5cd38c240fdc166ecc174300c2edea9bd019bd88494726524`,
file SHA-256
`5265ca063bd1f9a13b3a9106381b5e07e6ed16a8ee668578a587374921199c5e`.

The exact-capacity line assignment also selected masks 23–99. Its line-distance
cost was `1535.116392` versus `2839.508105` for masks 24–100, a
`1304.391713`-pixel margin. It then forced outlying/detached masks into lines to
satisfy transcript token counts. Examples include mask 86 from the prior line
assigned to `answer.`, mask 67 from the next line assigned to the line-5 `I`, and
mask 56 from the prior line assigned to a line-9 `I`. Its 51/77 baseline and 54/77
reviewed-valley counts are also invalid for promotion.

## Visual sealed evidence

The review builder is:

`scripts/build_semantic_binding_review.py`, SHA-256
`fb1f51d9e1fda371f1519ca071173a93308c7553f60621cacda2ec14d7433e4a`.

Output root:

`artifacts/semantic-binding-adjudication-v1/007-p02-pending`

- template identity SHA-256:
  `e0a49e3218ff8058ca2c3c6a4861e8ee39fa07a61f20e4891dbc34a5f82ee1af`;
- template file SHA-256:
  `811d9a24457e1052d044c564e4f39b1e8943b11f7f5fce0162dec5763885accb`;
- manifest identity SHA-256:
  `1541e96b953607210f663a2b69b70c41f3804ad777bd7e6389aebe315b30a44a`;
- manifest file SHA-256:
  `92918491c40deb60360d4b34887050c60d64a7d0c9dcd4858f9bf20761d3d888`.

Each evaluator-only board overlays completed masks as colored `H<number>` regions,
acting transcript units as cyan `U<number> text` boxes, and the acting fitted line
in red. Never expose these boards or the adjudication template to an acting model.

The local count mismatches are structural evidence of many-to-many binding:

| Line | Transcript units | Nearby completed masks | Visible issue |
| --- | ---: | ---: | --- |
| body-03 | 5 | 6 | `Dolly` appears split across masks 87 and 86 |
| body-04 | 5 | 4 | the `Sure` / `that` region is combined rather than independently labelled |
| body-05 | 6 | 5 | `how` / `much` is combined in one broad completed mask |
| body-06 | 5 | 6 | a word/detached stroke is split across completed masks |
| body-08 | 5 | 6 | the `any` region is split across completed masks |
| body-09 | 7 | 6 | the `it.` / following `I` boundary is not independently labelled |

All other lines have equal counts, but equal counts alone do not prove one-to-one
semantics. They still require review.

## Required adjudication contract

The pending template supports:

- one semantic unit → zero or more completed mask numbers;
- one completed mask → at most one semantic unit;
- unbound masks retained as residual/artifact evidence;
- an explicit missing-target state;
- a required persistent split when one completed mask spans two semantic words.

The ledger cannot be considered complete until every line is reviewed, no mask is
assigned twice, combined masks have been split or marked unusable, and the final
record is hashed before metric recomputation.

The completion gate is implemented in sibling POC
`src/word_envelope/semantic_binding_validation.py` with CLI
`scripts/validate_semantic_binding_adjudication.py`. It verifies sealed input
hashes without opening any raster, enforces whole-window disposition and
one-owner-per-mask, and requires notes for missing, partial, merged, or unbound
evidence. Six focused tests pass. The untouched template is preserved as a
negative control at
`artifacts/semantic-binding-validation-v1/007-p02-template-negative-control/validation.json`,
file SHA-256
`383248305322a8aac3395a310d28145b99a624bdba3a5e8246ba92052f254592`.
It correctly fails with 92 violations: 77 incomplete units, 14 incomplete line
coverages, and one incomplete record. This failure is required behavior, not a
benchmark regression.

## What remains valid

- The acting-only fitted centerlines are useful and visually coherent.
- The line-coordinate software produces materially different, exclusive component
  proposals with zero duplicate claims.
- The V1 memory failure and V2 outer-line spacing failure are valid negative
  engineering evidence.
- The eight acting-only choice/toggle packets remain leak-clean and ready for an
  isolated actor.
- Proposal-choice and component-transfer interfaces remain worthwhile hypotheses.

What is not valid is claiming semantic page-level accuracy or optimizing a method
against any current one-to-one proxy count.

## Next sequence

1. Complete the sealed many-to-many adjudication ledger using the 14 boards.
2. Split combined completed masks where exact semantic ownership is visually
   defensible; otherwise mark those units unavailable for exact scoring.
3. Run the strict completion gate, then freeze and hash the ledger before
   recomputing any proposal metrics.
4. Report coverage: exactly scorable units, merged target masks, split targets,
   missing targets, and unusable units before precision/recall.
5. Only then run the eight isolated acting packets and score proposal choice,
   component toggles/transfers, deferrals, and runtime.
6. Use a held-out page with a text-labelled many-to-many target ledger before
   promoting a deterministic line cutter or order heuristic.
