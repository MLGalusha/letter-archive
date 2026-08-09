# Eynollah capability audit and hybrid binarization trial

Date: 2026-08-09

## Outcome

Eynollah is useful to Letter Archive, but not as one end-to-end authority. Its
most valuable immediate component is the newer hybrid CNN-Transformer
binarizer. On three acting-safe pages it produced unusually coherent handwriting
evidence across faint, folded, and degraded paper. On the faint 003 page its
normal `0.50` mask contained 281,522 foreground pixels versus 125,678 from the
tested 2021 SBB convolutional checkpoint. It retained 96.93% of the old mask and
added 159,697 pixels, including many complete word portions rather than only
stroke thickening.

The same trial also established the limiting failure: on page 001 the hybrid
confidently selected circular glass-weight outlines and a vertical page edge.
Those errors remain at the normal threshold and therefore cannot be repaired by
a single global threshold. Eynollah binarization is a strong candidate-ink model,
not handwriting-only truth, word ownership, or a fitted-box model.

Recommended composition:

1. old/hybrid agreement supplies extremely safe positive ink seeds;
2. hybrid probability supplies the primary candidate-ink layer;
3. page and text-region geometry removes obvious non-document/non-text objects;
4. fitted Kraken/Eynollah line geometry constrains page-adaptive recovery;
5. a small page-specific classifier or graph propagation grows from safe ink
   through visually compatible faint strokes while retaining an unknown state;
6. unique line-local component ownership assigns candidate ink to words;
7. the existing deterministic shrink-wrap fitter derives the final envelope;
8. the human corrects unresolved ownership, not raw rectangles.

No completed human page, sealed ownership mask, or sealed evaluation result was
opened for this experiment. It is source-only characterization, not semantic
accuracy evaluation.

## What Eynollah actually provides

The current project is broader than the archived SBB inference repository. Its
documented capabilities include:

- page extraction and page-border detection;
- orientation classification, deskew, and layout preprocessing;
- document binarization using convolutional or hybrid CNN-Transformer models;
- document layout segmentation with regions such as text, header, image,
  separator, marginalia, initial, and table;
- text-line segmentation and conversion to boxes or contours, including curved
  and vertical text;
- reading-order estimation using heuristics or a trainable model;
- OCR using CNN-RNN or TrOCR models;
- image enhancement;
- PAGE-XML output;
- training and continued training for supported segmentation tasks.

Primary references:

- [Eynollah repository and use cases](https://github.com/qurator-spk/eynollah)
- [Eynollah model inventory](https://github.com/qurator-spk/eynollah/blob/main/docs/models.md)
- [Eynollah training documentation](https://github.com/qurator-spk/eynollah/blob/main/docs/train.md)
- [Archived SBB transition issue](https://github.com/qurator-spk/sbb_binarization/issues/72)

The project explicitly optimizes for output quality rather than speed. Current
published bundles are large: the 2026-07-15 inference layout bundle is about
1.85 GB, all inference models about 3.76 GB, and all training models about
5.64 GB. Running the entire suite for each interaction is therefore not a good
human-workspace design. Precompute page-level layers and use only the relevant
components interactively.

### Useful Eynollah responsibilities

| Capability | Letter Archive use | Decision |
| --- | --- | --- |
| Hybrid binarization | Candidate foreground probability on faint/degraded pages | Promote to bounded integration trial |
| Page extraction/border | Remove tabletop, outside-page background, and some page-edge distractions | Test before handwriting selection |
| Layout/text regions | Reject glass weights, images, seals, and non-text areas that look ink-like | Test as a permissive exclusion mask |
| Text-line contours | Complement Kraken baselines; provide curved/vertical corridors | Compare and fuse, do not replace Kraken without evidence |
| Reading order | Order the human queue and support unique sequential ownership | Metadata/support only |
| Training | Fine-tune binarization on corrected Letter Archive masks | Strong future path once complete pages exist |
| OCR | Optional anchor evidence | Low priority for difficult English cursive; never exact ownership |
| Enhancement | Proposal-only input for extremely low-resolution sources | Do not treat generated/enhanced pixels as source truth |

Eynollah recommends RGB input for best layout quality. Feeding it a previously
binarized page would discard color and paper evidence needed by its layout
models, so layout/page extraction should operate on the upright source image.

## Version and model-provenance caution

The current repository model specification names a preferred hybrid
`eynollah-binarization-hybrid_20230504` checkpoint. Some current fast-inference
bundle listings still expose the older `eynollah-binarization_20210425.onnx`,
while the training bundle contains the 2023 hybrid. Documentation, distribution
bundles, and older Hugging Face cards are therefore not perfectly synchronized.

The bounded experiment did not silently attribute the 2023 model to a different
file. It used the official SBB Hugging Face hybrid checkpoint released
2022-08-16 at repository commit
`cfdf4446f8e33b2c743a66bf7c1a4686515442ae`:

`https://huggingface.co/SBB/sbb_binarization/resolve/cfdf4446f8e33b2c743a66bf7c1a4686515442ae/saved_model/2022-08-16`

Observed architecture:

- input: `448 × 448 × 3`;
- output: `448 × 448 × 2` softmax;
- 36,988,874 parameters;
- ResNet-50-style encoder;
- eight multi-head-attention layers plus patch encoding;
- convolutional upsampling/skip decoder.

Exact model-file SHA-256 values are preserved in `cohort-summary.json`. A later
comparison should test the current 2023 Eynollah default checkpoint separately;
it must not replace or be conflated with this result.

## Three-page acting-safe trial

Artifact root:

`/Users/masongalusha/Workspace/projects/letter-archive-word-envelope-shrink-wrap-poc/experiments/word-envelope-shrink-wrap-poc/artifacts/eynollah-hybrid-binarization-trial-20260809`

Primary cohort record:

`cohort-summary.json`

Review board:

`cohort-p050-p020-review.png`

All probability maps were stored as full-resolution `float16` arrays; threshold
masks, component counts, pixel hashes, source hashes, board hashes, model hashes,
and CPU timings are retained.

| Page | Condition | p0.50 pixels | p0.20 pixels | CPU time | Acting-safe visual result |
| --- | --- | ---: | ---: | ---: | --- |
| `001-18881103-L01-01` | Faint writing, photographed page, two glass weights | 248,596 | 285,362 | 73.35 s | Writing is coherent, but glass rings and page edge are high-confidence false foreground |
| `002-19001113-L01-02` | Folded page on background | 316,630 | 349,716 | 81.58 s | Excellent broad handwriting recovery; folds and most paper texture suppressed |
| `003-18860314-L01-01` | Very faint ruled/folded letter | 281,522 | 328,473 | 40.46 s | Recovers many full faint word portions missed by the 2021 checkpoint |

The 001 failure is particularly valuable. It distinguishes **binarization** from
**handwriting selection**: glass edges and page borders share darkness, stroke
width, continuity, and curvature with writing. A pure pixel classifier can
reasonably call them foreground. Layout and line membership must supply the
semantic exclusion.

### Exact 003 comparison with the 2021 convolutional checkpoint

At probability `0.50`:

| Quantity | Pixels |
| --- | ---: |
| Old 2021 foreground | 125,678 |
| Hybrid foreground | 281,522 |
| Shared | 121,825 |
| Hybrid only | 159,697 |
| Old only | 3,853 |

The hybrid retains 96.93% of old foreground, and the hybrid mask is 2.2400 times
as large. Visual review shows coherent recovered words, so the increase is not
merely “more pixels is better.” It is nevertheless not a ground-truth score;
only a post-freeze comparison against complete human masks can measure target
recall and contamination.

Lowering the hybrid threshold from `0.50` to `0.20` adds between 33,086 and
46,951 pixels on these pages. The visual change is smaller than switching from
the old convolutional checkpoint to the hybrid. Model architecture/checkpoint
choice is therefore the major gain; a low global threshold is secondary.

## Independent Kraken-line conditioning on page 001

The first composition experiment used the existing frozen 14-line Kraken layout
for page 001. Its prepared-pixel coordinate space exactly matches the upright
source and hybrid mask. It did not derive geometry from the hybrid output and did
not use human ownership evidence.

Artifact root:

`/Users/masongalusha/Workspace/projects/letter-archive-word-envelope-shrink-wrap-poc/experiments/word-envelope-shrink-wrap-poc/artifacts/eynollah-line-conditioning-v1/001-18881103-L01-01`

Direct pixel intersection with the union of Kraken line polygons removed both
glass rings and almost all page-edge foreground:

| Polygon expansion | Selected hybrid pixels | Raw hybrid retained |
| ---: | ---: | ---: |
| 0 px | 194,273 | 78.15% |
| 15 px | 200,631 | 80.71% |
| 30 px | 206,873 | 83.22% |
| 60 px | 224,049 | 90.13% |

This confirmed that the strong line geometry can exclude high-confidence
non-text objects. It also reproduced the prior spikage failure: pixel clipping
visibly cuts real strokes wherever a line polygon is imperfect. The line should
decide component admission, not crop accepted ink.

A second policy preserved each admitted connected component whole. Using a
30-pixel corridor:

| Minimum component overlap | Selected pixels | Components accepted | Result |
| ---: | ---: | ---: | --- |
| 10% | 237,344 | 355/444 | Too permissive; bottom ring and page edge return |
| 25% | 204,368 | 353/444 | Promising page-bound result; both rings and page edge excluded, components remain whole |
| 50% | 201,445 | 352/444 | Too strict; removes one additional 2,923-pixel writing component near the top line |

At 25%, the rejected set contains 44,228 pixels. The two glass rings and vertical
page edge account for 36,256 of them (81.98%), based on exact component areas and
source-coordinate boxes preserved in the manifest. This is a materially better
operation than pixel clipping: geometry rejects complete foreign objects without
creating broken stroke boundaries.

This remains a one-page development result. Kraken found 14 lines, so any missed
salutation, signature, marginalia, page number, or rotated writing needs a
residual/alternate-orientation stream. It must not be deleted simply for being
outside the main line union. The `30 px / 25%` policy is promoted only as a
held-out candidate for pages with independently frozen line geometry.

### Frozen-policy check on independent page 002

The unchanged `30 px / 25%` whole-component policy was then applied to page
`002-19001113-L01-02`. The frozen Kraken layout has 37 lines. Its prepared image
and the human-workspace source are byte-different PNG files but decode to exactly
the same RGB pixel array (`a9db0757...`), so no coordinate reprojection or visual
approximation was used.

Result:

- raw hybrid: 316,630 pixels in 544 components;
- accepted: 316,366 pixels in 541 components;
- retained: 99.9166%;
- rejected: three components totaling 264 pixels;
- all rejected pixels lie at the extreme top image boundary, outside the
  photographed paper;
- no missing word or long stroke is visible at full-page review scale;
- thresholds 10%, 25%, and 50% all made the same decision on this page.

This is independent recall-safety evidence on an already-clean page. It is not a
second specificity win because page 002 contained no glass/page-edge foreground
like page 001. Page 003 had no matching independently frozen line layout and was
correctly excluded instead of deriving circular line evidence from the hybrid
mask itself.

## Hybrid-seeded page and local source recovery

The next experiment reused the existing Letter Archive local recovery algorithm.
It learns source colour residual, local/broad paper-normalized darkness, Sato
ridge response, proximity, principal writing direction, and straight-artifact
penalties from an accepted ink anchor. The hybrid `p0.50` mask replaced the older
generic seed.

### Full-page conditioning: rejected

Artifact root:

`/Users/masongalusha/Workspace/projects/letter-archive-word-envelope-shrink-wrap-poc/experiments/word-envelope-shrink-wrap-poc/artifacts/hybrid-seed-page-recovery-v1/003-18860314-L01-01`

| Profile | Added pixels | Addition components | Added pixels where hybrid p < 0.01 | Result |
| --- | ---: | ---: | ---: | --- |
| Conservative | 17,289 | 793 | 12,200 | Some useful faint fragments, but ruling/fold/page-border evidence and specks |
| Balanced | 63,721 | 3,901 | 45,238 | More faint structure, much more fragmentation and physical-page evidence |
| Maximum recall | 138,948 | 11,237 | 103,842 | Unacceptable page-edge, fold, ruling, texture, and component explosion |

The run took 145.55 CPU seconds. It proves that source recovery can find evidence
the hybrid gave almost no probability, but one page-wide appearance model is too
broad. It also confirms that this work belongs in precomputed/cached page layers,
not the per-click interaction loop.

### Local conditioning: promising optional assistance

Artifact root:

`/Users/masongalusha/Workspace/projects/letter-archive-word-envelope-shrink-wrap-poc/experiments/word-envelope-shrink-wrap-poc/artifacts/hybrid-seed-local-recovery-v1/003-18860314-L01-01`

The same algorithm was frozen over four broad difficult crops plus tighter
counterparts for `enough` and `acknowledgement`. Six crops completed in 4.94 CPU
seconds. No human answer or sealed completed-page evidence was used.

Acting-safe visual review found:

- conservative local recovery reconnects multiple faint source-visible word
  fragments, including evidence with hybrid probability below `0.01`;
- balanced recovery often exposes more real faint letter structure but also more
  disconnected debris and local foreign evidence;
- maximum recall is consistently too noisy;
- the fold-crossing crop still attracts some fold/rule evidence, proving that
  local scope helps but does not replace line/word geometry;
- a tight `enough` crop reduced conservative additions 2,805→457 (83.71%) and
  balanced 7,042→1,520 (78.42%), but restored only fragments of the extremely
  faint tail;
- a tight `acknowledgement` crop reduced conservative additions 2,132→1,705
  (20.03%) while preserving several useful gap continuations.

This promotes a staged proposal policy rather than a global recovery mask:

1. begin with a tight rough word box and conservative recovery;
2. preserve the hybrid anchor separately from red recovered candidates;
3. if incomplete, expand primarily along the fitted line;
4. offer balanced evidence only after conservative remains incomplete;
5. never select the recovery pool wholesale;
6. preserve residual/outside-line evidence for omitted words and marginalia.

This independently converges with the earlier page-007 conditioning sweep:
larger conditioning exposes more target evidence and much more foreign evidence.
The new result adds an important qualifier: Eynollah supplies a substantially
better anchor, but the same geometry/scale discipline remains necessary.

## The page-adaptive “vector” idea

The user's vector idea is technically plausible if “vector” means an embedding
or feature vector learned for each source pixel/patch. The reliable model output
can act as page-specific examples rather than a final mask.

For every candidate pixel or small connected piece, build features from:

- an intermediate hybrid-encoder embedding;
- hybrid and old-model probabilities and agreement state;
- source Lab color and paper-normalized contrast;
- local ridge/tubularity response;
- stroke width and connected-component shape;
- distance to, and tangent agreement with, the fitted text line;
- location inside page/text-region masks;
- neighboring confident-ink features.

Labels available without exposing sealed answers:

- hard positive seed: old `p0.50` intersect hybrid `p0.50`, inside a text line;
- hard negative seed: very low hybrid probability, outside text regions, or
  confidently outside the extracted page;
- unknown: everything ambiguous, including unreviewed faint candidates.

A tiny page-specific logistic classifier, linear SVM, or nearest-prototype model
can estimate “looks like this page's ink.” More promising still is a graph
method—random walker, graph cut, or CRF—because handwriting continuity matters:

- unary cost comes from model foreground probability;
- positive and negative seeds are clamped;
- graph edges favor similar source color/embedding, proximity, local stroke
  direction, and the same fitted line;
- propagation cannot cross strong line/region boundaries;
- low-margin pixels remain unresolved rather than becoming background.

This uses the pretrained model's best strokes to adapt to the page's writer,
ink, exposure, and paper without retraining a large network. It also addresses a
failure the threshold sweep cannot: whole faint words that receive near-zero
probability may still resemble confident writing in encoder/color/line feature
space.

Risks that must be measured:

- positive-only self-training can reinforce the teacher's omissions;
- glass rings and page edges can be visually similar to ink, so geometry is
  essential;
- a page can contain pencil, multiple inks, or severe exposure gradients, so one
  global prototype may be wrong;
- source-color propagation can leak through folds or ruling;
- embeddings trained for binary foreground may not separate handwriting from
  other dark line art.

The experiment must therefore compare target continuity, foreign-object
contamination, unresolved ink, and human correction effort—not recovered-pixel
count alone.

## What to train, and in what order

### First: domain-adapted ink/foreground model

Fine-tune the hybrid checkpoint on completely audited Letter Archive pages.
Derived union-ink masks provide binary foreground; exact word masks also allow
the same data to support ownership later. Preserve an explicit ignore/unknown
mask. An unfinished page must never label its untouched words as background.

Useful classes for a Letter Archive-specific extractor are:

- certain handwriting;
- ambiguous/faint handwriting candidate;
- non-handwriting foreground such as glass/page edge/seal;
- background;
- ignore/unresolved.

If Eynollah training expects binary labels initially, use foreground plus ignore
and evaluate non-text errors separately. A multi-class head can follow after the
label policy is stable.

### Second: line-conditioned word ownership

Binarization alone cannot decide which word owns a dot, cross-stroke, flourish,
or touching component. Use exact human word masks to train or score a model that
assigns candidate components/pixels to ordered word instances inside a fitted
line. It should consume source pixels, hybrid probability, line coordinates,
rough Kraken/Eynollah anchors, and optional transcript token context. It must
allow abstention and unique provisional ownership with explicit transfers.

### Deterministic final geometry

Do not train a separate model merely to draw conventional rectangles if the
accepted word mask is available. The existing fitted-envelope algorithm can
derive a tight, reproducible box/envelope from that mask. Train learned geometry
only if later evidence proves the deterministic fitter is the bottleneck.

Thus the likely long-term answer is two learned responsibilities, not two generic
box models:

1. clean candidate-ink extraction;
2. semantic word ownership;
3. deterministic fitted geometry.

## Human-workspace implication

The hybrid should first appear as an optional, precomputed **Hybrid Ink** layer,
not silently replace the current selector. The human should see:

- certain ink: old/hybrid agreement inside text geometry;
- likely ink: hybrid `p0.50` inside text geometry;
- possible ink: page-adaptive recovery and/or lower probability;
- excluded non-text: visible but not selectable by default;
- unresolved: intentionally left for the human.

The efficient action is to accept a software-owned word mask, add/remove a few
colored components, and commit. Fitted boxes are generated immediately from the
corrected mask. Every correction becomes training data, including the model
version and exact proposal that the human corrected.

## Next bounded experiments

1. Freeze the `30 px / 25%` whole-component line policy on more independent noisy
   pages with exact prepared-coordinate geometry. Preserve a separate residual
   stream for writing not represented by any detected line.
2. Compose the local conservative recovery with a fitted line and rough word
   corridor. Sweep only along-line expansion while keeping across-line reach
   fixed, and compare correction effort rather than added-pixel count.
3. Build a seed-driven embedding/graph propagation challenger and compare it
   with the now-frozen local source-colour recovery baseline.
4. Download and hash the current Eynollah 2023 default hybrid checkpoint; repeat
   the exact frozen cohort without changing thresholds or evidence.
5. Add a fourth acting-safe failure page with mixed ink/pencil or severe shadow.
6. Expose hybrid anchor plus conservative/balanced local additions as distinct
   optional selector layers and measure
   human corrections and seconds per completed word.
7. After enough fully residual-audited pages exist, freeze letter/writer-level
   train/development/test splits and fine-tune the extractor.
8. Use the exact per-word masks to train/evaluate line-local unique ownership;
   keep the fitted envelope deterministic.

The next implementation should be geometry-conditioned hybrid ink, because it
directly addresses the observed high-confidence false objects while retaining
the largest faint-writing improvement measured so far.
