# Checkpoint: disjoint component ownership and accuracy-v2

Date: 2026-08-08
Scope: page `007-p02`, 77 body words plus one frozen 10-word diagnostic
Evidence rule: acting candidates were frozen before sealed human evaluation was
loaded. The completed human page was never placed in an acting packet.

## Outcome

Exclusive connected-component allocation is the strongest deterministic ownership
proposal tested in this iteration. On transcript locators it produced 56/77
high-quality word selections, versus 33/77 for independently owning every touched
component. It removed all duplicate component claims while leaving only 1,686 more
Clean pixels in the residual than the independent baseline.

This is a promoted **software suggestion**, not an automatic answer. Its acting
easy gate was 50/61 precise (81.97%), leaving 11 false approvals. Reading-order
knockout was helpful, but forward and reverse order assigned 41 transcript-locator
components to different words. First-touch ownership is therefore too unstable to
be authoritative.

## Frozen automatic-selection failure atlas

Artifact:
`artifacts/auto-selection-failure-atlas-v1/007-p02-transcript-margin0/`
inside the sibling word-envelope POC.

- Atlas SHA-256:
  `45de0c5634a6301408dce925d3c01957b4851df969b2b519c7d854a5e9f56aa`
- False automatic approvals: 12.
- Nine touched an entirely foreign component; seven captured a same-line neighbor;
  two crossed a line; four had locator/target mismatch; two were incomplete.
- None of the 12 required one connected component spanning both target and foreign
  human words. The dominant error was assignment, not an unavoidable shared stroke.

Meaning: rank and allocate components globally before asking an agent to repair the
hard remainder.

## Ownership-independent recovery conditioning

The first sweep is preserved as invalid for decision because conditioning-anchor
Clean pixels outside fixed ownership were accidentally omitted from optional
evidence:
`artifacts/recovery-conditioning-sweep-v1/007-p02-ten-word-mixed/INVALID-FOR-DECISION.md`.

Corrected artifact:
`artifacts/recovery-conditioning-sweep-v2/007-p02-ten-word-mixed/`.

- Experiment SHA-256:
  `a717715d65ee771f34866a3bff0bc059b59651adacaa89136fae27468174a7c7`
- Experiment file SHA-256:
  `3c8091e31ec9df76341c99eac285b720f606bfa6019acb4af3476ed9b0427087`
- Fixed ownership was identical at 0%, 10%, 18%, 30%, and 45% conditioning.
- Target/foreign optional evidence was 3,147/12,156 px at 0%, 8,339/39,488
  at 18%, and 11,988/80,133 at 45%.
- Only two of ten incomplete words (`much`, `day-`) gained target evidence. The
  other eight gained foreign evidence without recovering target pixels.
- Median recovery time remained approximately 0.21 seconds.

Meaning: a larger region is useful only as demand-triggered recovery conditioning
after a concrete incompleteness cue. It must not enlarge ownership by default.

## Disjoint component experiment

Code:

- `src/word_envelope/component_assignment.py`, SHA-256
  `0c9e787d138cbdac3ee89f70fc43882af58797a69a7cc902bd4261e1b10a624f`
- `tests/test_component_assignment.py`, SHA-256
  `ba44bfed1e78dca06f68770e87311bbc79178874d5a366f9320b717edb646b28`
- `scripts/experiment_disjoint_component_ownership.py`

Artifact: `artifacts/disjoint-component-ownership-v1/007-p02-body77/`.

- Experiment identity SHA-256:
  `84f39f029e3bef70afa50a76b21434019acfb32fa992f9d0617764fd20c04a78`
- `experiment.json` SHA-256:
  `394a96ef0273ba9eeb5b198db1a1a83d8ec01362686e8062e5d2d2eca125eff0`
- Acting board SHA-256:
  `54dfb0ac4055dd0668d1e7c1f6df1f59c1262494a77969d94c775c93917e1c00`
- Sealed evaluation board SHA-256:
  `f965a55e16d183d14eb66090b14841476d927a0488eefde885a1b3c163bcde08`

### Reviewed/Kraken-derived locators

| Policy | High quality | Acting easy precision | Duplicate claims | Clean residual px |
| --- | ---: | ---: | ---: | ---: |
| Independent touched | 22/77 | 12/16 = 75.00% | 76 | 186,244 |
| Sequential reading | 39/77 | 22/24 = 91.67% | 0 | 186,244 |
| Sequential reverse | 19/77 | 15/19 = 78.95% | 0 | 186,244 |
| Confidence first | 37/77 | 26/35 = 74.29% | 0 | 186,244 |
| Global exclusive + ambiguity abstain | 41/77 | 30/45 = 66.67% | 0 | 212,904 |

### Transcript locators

| Policy | High quality | Acting easy precision | Duplicate claims | Clean residual px |
| --- | ---: | ---: | ---: | ---: |
| Independent touched | 33/77 | 30/37 = 81.08% | 41 | 165,688 |
| Sequential reading | 43/77 | 38/45 = 84.44% | 0 | 165,688 |
| Sequential reverse | 24/77 | 24/33 = 72.73% | 0 | 165,688 |
| Confidence first | 44/77 | 40/47 = 85.11% | 0 | 165,688 |
| Global exclusive + ambiguity abstain | 56/77 | 50/61 = 81.97% | 0 | 167,374 |

The global method scores every component against all word locators, assigns it to
one best-supported word, and abstains on insufficiently separated competitors.
It improved common boundary failures such as `you`, `know`, `that`, `won't`, and
several `I` tokens. Exact agreement across locator/order variants did not raise
precision enough to justify automatic acceptance; even the best tested consensus
gate remained below the required safety level.

## Component score-weight sweep

Artifact: `artifacts/component-score-weight-sweep-v1/007-p02-body77/`.

- 49 acting configurations were frozen before sealed evaluation: seven weight
  profiles times seven ambiguity margins.
- Frozen candidate-set SHA-256:
  `6563f8ae91c5d6de48a903508638ef1de72ceba121caae2041231d28f2e9802e`
- Frozen file SHA-256:
  `6d3f1474467c043f6eaec0e8083dd150b45d95a7d62b1be6809b055dcf419c46`
- Candidate freeze time: 44,491.073 ms.
- Experiment identity SHA-256:
  `2712be6fc410da927fd69e44a86eeadc32135a6ce94a2c4eb61a4365e6a98ade`
- Experiment file SHA-256:
  `2dbb05ec04d847b84d77f25e4bc4dac59bb93cdf3e45d85adbc739cdf3292e69`
- Sealed score-grid SHA-256:
  `a5aabe063b5bca0aa3abfe21ae4a1ea18191f9f885a7d7eb81a30b0dfff1b911`

The apparent best `center_xy`/0.06 setting reached 57/77 high-quality versus
56/77 for the current weights/0.08. It changed only two ownership assignments:
it correctly withheld component 53 (378 foreign pixels) from `answer.`, and it
assigned a one-pixel disputed component to already-bad `felt` without repairing
that word. Foreign-error words fell 16→15, misses stayed 11, and Clean residual
grew 167,374→167,751 pixels.

Line-held-out selection across the grid produced only 51/77 high-quality and chose
five different configurations. The one-word aggregate gain is therefore fragile
and page-specific. Do not promote the new weights; retain the current scoring
profile while developing a more specific locator-crossing feature.

## Cross-line abstention sweep

Artifact: `artifacts/cross-line-component-abstention-v1/007-p02-body77/`.

- Eight cross-line margins from 0.08 through 0.60 were frozen with the within-line
  margin fixed at 0.08.
- Frozen candidate-set SHA-256:
  `bf0b81655257ec92de6586642eba12b5e0d8b66da5b516c7ec0f07770da3dd52`
- Frozen file SHA-256:
  `f78d28aac043b1df7ae55b369bdb970a757ea8e099513c5e1214f3b6a9b95201`
- Candidate freeze time: 7,167.143 ms.
- Experiment identity SHA-256:
  `4ccaa7b76cdfb4fc3841eddca8b810381dfb522b73b89ab8e96ba2bd19ee0cab`
- Experiment file SHA-256:
  `d9a11c6b3c60650bb78e3f8f6b91ab9899d42fb6f8991d6b22efb2c51f952f3e`
- Sealed margin board SHA-256:
  `dc1a4a0a50bacd15e990e6af09d528118137e141992325a8b02ae4d8d7107d16`

A 0.22 cross-line margin removes the foreign component from `answer.`, but also
withholds 2,695 target pixels from good words: high-quality count falls 56→55,
missed-error words rise 11→13, and residual grows 3,073 pixels. At 0.60 the result
falls to 50/77 high-quality with 20 missed-error words and 52,478 cross-line
ambiguous pixels. Line-held-out threshold selection produced 53/77 high-quality.

Decision: reject a blanket cross-line penalty. A useful next feature must detect
that the *locator itself* crosses the neighboring line or that a component is
poorly supported by the winner's local stroke field; legitimate long strokes must
not be rejected merely because another line is the runner-up.

## Acting-only ink line field

The next experiment bootstrapped one robust line center from components assigned
with a strict 0.30 score margin. It used only Clean ink, software locators, and
machine assignments. The acting centerline record and board contain no human data:

- Record SHA-256:
  `a26f19eeb1a63d877a402afb84e9dee1f2fb1b4ad165ec9f10c6599599d90aee`
- Record file SHA-256:
  `c4ecb680941048900562e4a4090761398536a40701fc36a67f371ee8578ba474`
- Acting board SHA-256:
  `93674de8e516a7c0c82f27c8e128c3be94ed8f43d5b3617286213923606ee9b5`

Applying line support to every component was rejected. It correctly withheld the
foreign piece from `answer.` but removed a major target component from `now`, whose
recall fell 1.000→0.342. High-quality count stayed 56/77 and line-held-out selection
fell to 55/77. Preserve
`artifacts/component-line-field-sweep-v1/007-p02-body77/` as negative evidence.

The refined cross-dispute-only experiment is at
`artifacts/component-line-field-cross-dispute-v2/007-p02-body77-min50/`.

- Support is applied only when the top two locator candidates belong to different
  lines and the component has at least 50 pixels.
- Fixed development candidate: support weight 0.50, centerline scale 1.5, ordinary
  exclusive margin 0.08.
- Frozen candidate-set SHA-256:
  `a870e6e05fc57e3a23f77fad0cb9878098ba1c58a2a9c6e1fd253658ce52e90c`
- Frozen file SHA-256:
  `1d16be09957747ee21cc2715e6e71303cd2fe90fe00957e82f275b6bde3af414`
- Candidate freeze time: 11,738.180 ms.
- Experiment identity SHA-256:
  `1e50e2968089ad44d0a3260232d76b714bbc513bd62d47a13f2b6bf8127814e8`
- Experiment file SHA-256:
  `0a79d8b44b066e8d3925bcd563d6de8e92351672e389025822ffcdf3d430741d`
- Sealed grid SHA-256:
  `028c17d099c298773c1264de3092cbda60b7f90b733716786da56e7771f90a0d`

At the fixed conservative setting, exactly one of 77 masks changes: component 53
(378 pixels) is withheld from `answer.`. That word's precision improves
0.960319→1.000000 with recall unchanged at 1.000000. High-quality count improves
56→57, foreign-error words fall 16→15, missed-error words stay 11, and Clean
residual grows only 378 pixels to 167,752. No other word changes.

Decision: promote this exact policy only as a page-bound software suggestion guard
for held-out validation. Do not promote the more aggressive setting that reassigns
component 53 to `don't`; it also assigns a 1,685-pixel component to an incorrect
empty `I`. One no-regression correction is promising but not generalization.

## Accuracy-v2 supervisor state

`src/word_envelope/sequential_ownership.py` now binds an explicit Clean mask and
High Recall superset, verifies dimensions and `Clean subset High Recall`, records
both hashes in run identity, treats the old knockout mask as provenance only, and
supports an explicit canonical diagnostic subset. SHA-256:
`55900f06b9962e72430e282287378a9df56d35f6d0db48cda7ead0ee1e5dc681`.

The 24 sequential-ownership tests and 11 component-assignment tests pass.

Full run, frozen at revision 0:
`artifacts/full-page-sequential-ownership-v2/007-p02-accuracy-v2-v4/`.

- Run id: `007-p02--3099f5674cf0d4e1`
- Manifest SHA-256:
  `a80ddecea68175cdaf9aa5eea0c665f8bdeb40031e1bf396be52d91c6c21dd05`
- Clean pixel-mask SHA-256:
  `3283b19570b986493e7490567254e0f17d031eae7cf9933798c00a3cdb557606`
  (625,101 pixels)
- High Recall pixel-mask SHA-256:
  `599bc558dcad60a009e0aa44444f41f56cccae914925d3669e448a36323baed4`
  (686,035 pixels)

Ten-word diagnostic, frozen at revision 0:
`artifacts/full-page-sequential-ownership-v2/007-p02-accuracy-v2-v4-sample10/`.

- Run id: `007-p02--8f3566796a3283ca`
- Manifest SHA-256:
  `e3606f2336ce2e09ef1f3854c90e72bdeb2148ba68fd7ae2644d70ebb39ff8be`
- Queue in canonical page order: `so`, `times.`, `By`, `now`, `you`, `know`,
  `won't`, `Love`, postscript `you`, postscript `O.K.`
- The first `so` packet was rendered and inspected. It exposes no sealed answer.
- A structural packet-boundary validator passed all 12 files with zero violations,
  recomputed referenced evidence hashes, verified paths remain inside the run, and
  scanned text/path markers. Validation SHA-256:
  `842c3d5c70a42ae8e8df2c88fc32f84a92b8079dbe6e4af6b7e467969b832041`;
  receipt file SHA-256:
  `b4d0d5570f674cae7faf4838873a5647d3c7eb3104944e5e005ba2dad6de34d9`.
- No decision was applied. The ChatGPT runner is unconfigured, Claude inference
  access was denied before token processing, and the local Codex CLI is broken.
  See `MODEL-RUN-BLOCKED.md`, SHA-256
  `a3e8ccc30a1d89c9c3c9867ff2d5b1f2cfa569ffbc8f36be5d1325acb679b4f2`.

## Decision and next bounded experiments

1. Use transcript-locator global exclusive assignment as the default *suggestion*
   surface, never as automatic truth.
2. Present ambiguity margins and competing-word support to the acting agent so it
   spends effort on boundary disputes rather than rediscovering easy components.
3. Calibrate a reject option on frozen development words using component score
   margin, outside-locator extension, neighbor overlap, and proposal consistency;
   evaluate precision, recall, correction count, and fresh residual together.
4. Resume the unchanged ten-word model sample only through an isolated,
   authenticated route. Freeze all model actions before opening sealed evaluation.
5. Test residual-driven repair after component allocation. A larger recovery box
   may be offered only for words with visible missing-stroke or missing-component
   evidence.
6. Add a global manifest registry and an automated public-packet leak validator.

Item 6 is now implemented for the current iteration. The machine-readable registry
`ARTIFACT-REGISTRY.json` contains 12 entries and passed path, primary-record hash,
enum, unique-id, and predecessor validation with zero violations. Registry file
SHA-256: `4cc8f50d8d2e627c61a3703e19e62293bcb49c3b89010d75df287662fa702910`.

The packet validator is implemented in
`src/word_envelope/acting_packet_boundary.py` with CLI
`scripts/validate_acting_packet_boundary.py`. It detects structural/path/hash and
known-marker leaks; it cannot determine whether a visually innocent raster itself
contains forbidden information. The registry currently covers this ownership
iteration, not every legacy handwriting artifact family.

Disk space was critically low during this iteration. No immutable evidence was
deleted; future raster experiments should remain small and purpose-built until
space is deliberately reclaimed.
