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

## Crop, scale, and source-preprocessing probes

The next acting-safe experiment asked whether the frozen 2022 hybrid checkpoint
could recover faint writing better when it saw a crop rather than a full page.
Three source-coordinate crops were frozen before inference:

- `folded-write-to-you`: fold/rule contamination plus moderately faint writing;
- `enough-tight`: an almost-erased word tail;
- `acknowledgement-tight`: a longer faint continuation.

Every crop candidate was projected back to the same source coordinates and
compared with the preserved full-page probability. No completed human page or
sealed ownership evidence was opened. Candidate-only pixels were treated as
disagreement evidence, not recovered truth.

The multiscale result rejects tight or enlarged crop inference as the default:

- the released tight-crop path surrounds a 300–350 px-high crop with black to
  reach the model's 448 px input height; it retained only 63.70%, 0.00%, and
  45.47% of the full-page `p0.50` ink on the three probes;
- adding 160 px of real source context was safer, but on `enough-tight` it still
  retained only 8.91%;
- 2× enlargement retained only 44.65%, 1.04%, and 12.32%, showing that making
  strokes visually larger moved them away from this checkpoint's learned scale;
- native real-context inference on `acknowledgement-tight` retained 90.34% and
  proposed 4,608 extra pixels. Some followed faint writing; some merely
  thickened already-found strokes.

The exact multiscale record is
`artifacts/eynollah-crop-multiscale-v1/003-18860314-L01-01/experiment.json`
(SHA-256
`963d15a5b77e4345be4e753d846c5fbb3ac877eefe32f294b95dcd9f17459247`;
64.91 s crop inference plus 4.86 s model load on CPU).

A second frozen experiment kept native scale and changed only the source
presentation inside the same real-context windows:

- LAB CLAHE, clip limit 1.5;
- paper-background flattening with gains 1.0, 1.5, and 2.0;
- unaltered RGB context as the crop baseline.

CLAHE was the only consistent challenger. At `p0.50` it retained 93.28%,
99.12%, and 94.52% of the full-page anchor while proposing 3,605, 7,051, and
6,262 additional pixels. Visual review found plausible continuations on the two
moderately faint probes, but also stroke thickening and responses to non-writing
marks. On the almost-erased `enough` tail, the raw mask mostly recovered
stronger neighboring strokes; the target remained fragmentary at both `p0.50`
and `p0.20`.

Paper flattening made the source easier for a human to inspect but did not make
this model reliably select the nearly erased writing. This is evidence of a
model-confidence cliff, not merely a display-contrast failure.

The exact preprocessing record is
`artifacts/eynollah-crop-preprocessing-v1/003-18860314-L01-01/experiment.json`
(SHA-256
`e0f6f778fedcd94f9e0d8760ad81870e753f76b83e2754e6bf814b758a4f5975`;
42.24 s crop inference plus 4.50 s model load on CPU).

Decision:

- retain the full-page hybrid probability as the primary anchor;
- do not silently union tight-crop, enlarged-crop, CLAHE, or flattened outputs;
- expose native-scale CLAHE only as a distinct optional proposal layer;
- gate CLAHE-only components with source darkness/ridge continuity and fitted
  line/word geometry before offering them for one-click acceptance;
- use the unaltered source raster for final ownership and fitted geometry.

### CLAHE × source-recovery component gate

A third acting-safe experiment composed the two independent proposal mechanisms
without unioning their pixels. It formed CLAHE-only `p0.50` components, dilated
the conservative or balanced local source-recovery additions by one pixel, and
kept a whole CLAHE component only when 10% or 25% overlapped that evidence.

The conservative gate materially reduced proposal burden on moderately faint
writing:

- `acknowledgement-tight`: 6,262 CLAHE-only pixels in 638 fragments became
  4,077 pixels in 31 whole components;
- `folded-write-to-you`: the 25% policy kept 1,783/3,605 pixels in 17
  components while removing many unsupported specks;
- `enough-tight`: the same policy reduced 7,051 pixels to 1,429 in five
  components, but those components were still mainly stronger neighboring
  letters and did not reconstruct the nearly erased middle.

On `acknowledgement` the 10% and 25% thresholds were identical, and on the
folded crop they were nearly identical, because supported components already had
substantial overlap. The evidence therefore supports conservative whole-component
gating as an optional moderate-faint proposal layer; it does not support a
globally optimized overlap threshold or claim to solve near-erasure.

Exact record:
`artifacts/clahe-recovery-component-gate-v1/003-18860314-L01-01/experiment.json`
(SHA-256
`d07e8701b1f199e1be1f76e074c8e3300df595b66bd4e57aa8115227c8f5aa7a`;
2.96 s CPU). The record preserves every connected-component box, area, evidence
overlap, admission decision, mask hash, and review board.

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

## Page-adaptive source-vector results

The source-vector idea was tested without any completed human page or sealed
ownership evidence. Each crop used ten exact-source features: Lab colour,
grayscale, darkness relative to three Gaussian paper backgrounds, Sato ridge,
Sobel gradient, and local standard deviation. Eynollah `p>=0.95` supplied safe
positive seeds. Very bright, flat `p<=0.0001` paper supplied initial negatives.

Three model families were compared on the same frozen `folded-write-to-you`,
`enough-tight`, and `acknowledgement-tight` crops:

- nearest positive/negative feature prototypes;
- a small histogram gradient-boosted classifier;
- source-feature random-walker propagation;
- a two-of-three agreement mask.

The first run produced the first tested recovery of most of the disconnected,
nearly erased `enough` word. The raw prototype proposed 24,625 pixels in 2,946
components; 22,030 pixels occurred where hybrid probability was below 0.01.
This supported page-local appearance vectors, but paper texture made the mask
unusable. The boosted classifier achieved pseudo-label holdout AUC 1.0 while
flooding crops with 58,736–214,990 pixels, proving that reproducing easy
software-derived seeds is not human-truth accuracy. Random walking was cleaner
but stayed close to seeds and missed the disconnected word; voting discarded
the breakthrough.

Exact first-run record:
`artifacts/page-adaptive-vector-ink-v1/003-18860314-L01-01/experiment.json`
(SHA-256
`18e4db46a57ee23af4db4a8e77fcdfb290aa52c95663da28195b2d5f57341c19`;
9.68 s CPU).

### Natural faint-word enhancement and Eynollah reinference

The near-erased `enough-tight` crop was frozen for a bounded natural-visibility
experiment. Eight source-only transformations were compared using median
contrast on the line-vector faint proposal, paper-proxy standard deviation,
SSIM to the source, mean RGB change, and clipping. These are acting-safe probes,
not human truth.

Generic operations exposed the expected failure modes. Paper flattening reduced
faint-proxy contrast from 0.1112 to 0.0910. Unsharp masking raised it only to
0.1227 while increasing paper standard deviation from 0.0165 to 0.0237. A blunt
dark-ink boost reached 0.2645 but visibly strengthened paper fibres and reduced
SSIM to 0.871.

The stronger bounded idea learned the robust LAB direction from conservative
paper pixels toward Eynollah's confident ink pixels, estimated a local paper
background, and amplified only residuals aligned with that page-specific ink
direction. It did not draw, inpaint, or synthesize strokes. The page-ink vector
variant raised faint-proxy contrast to 0.2293 (2.06x), retained SSIM 0.911, and
clipped no channels. A Sato-ridge-gated version reached 0.1720 (1.55x) while
keeping paper standard deviation within 5.25% of the original and SSIM 0.963.

Exact visibility record:
`artifacts/natural-faint-word-enhancement-v1/003-18860314-L01-01/experiment.json`
(SHA-256
`3a1fa7967c64d156030302a73b103805ab77b1e1fbb9aed34f3ae9bf9af9f703`;
8.91 s CPU including full-context preparation).

The original, blunt dark-ink, page-ink-vector, and ridge-gated variants were
then passed through the exact frozen 2022-08-16 Eynollah checkpoint at native
scale with the same 160-pixel real context. This was a real model rerun, not a
visibility inference. At p0.50:

| Context input | Faint-proxy selected | Full-page anchor retained | Conservative paper proxy |
| --- | ---: | ---: | ---: |
| original | 64/6,571 (0.97%) | 8.91% | 0 |
| dark-ink | 2,285/6,571 (34.77%) | 72.61% | 0 |
| ridge-gated ink vector | 2,165/6,571 (32.95%) | 68.99% | 0 |
| page-ink vector | 2,285/6,571 (34.77%) | **90.65%** | 0 |

At p0.20, page-ink vector selected 3,205/6,571 faint-proxy pixels (48.77%),
retained 88.33% of the full-page anchor, and selected one conservative
paper-proxy pixel. It is therefore the least-dominated tested challenger.
Visually it recovers coherent portions of the erased word, but remains
fragmented and also recovers legitimate neighboring-line strokes at crop edges.
The paper proxy is deliberately conservative and cannot prove ownership.

Promote page-ink-vector Eynollah p0.50 as an optional secondary proposal and
p0.20 only on defer. Keep untouched full-page hybrid output as the anchor. Never
replace it or union the enhanced result automatically; apply line/word geometry,
component ranking, and human correction afterward.

Exact reinference record:
`artifacts/enhanced-eynollah-reinference-v1/003-18860314-L01-01/experiment.json`
(SHA-256
`e0ad9207ec3e74cbe959cfd1ccab36b6d9c6159494c5415a20d58043ade0e4ac`;
9.83 s inference plus 4.02 s model load on CPU).

### Positive–unknown line conditioning

The second run introduced a rough centered line corridor covering 22%–78% of
each frozen crop. It added difficult paper negatives only outside that corridor
and left every low-probability pixel inside it unknown. It did not teach the
near-erased target that a missing teacher prediction meant background.

On `enough-tight`, prototype/classifier agreement reduced the first raw
prototype from 24,625 pixels/2,946 components to 7,502/239—a 69.53% pixel and
91.89% component reduction—while visually preserving most of the erased word.
Of those additions, 6,571 had hybrid probability below 0.01. The same frozen
method produced coherent moderate-faint continuation evidence on the folded and
acknowledgement crops. A fixed directional-density filter removed only about 4%
and was not independently useful.

Exact line-conditioned record:
`artifacts/line-conditioned-vector-ink-v1/003-18860314-L01-01/experiment.json`
(SHA-256
`3f5f6213120731016fb3bedc60032bccb06f37efc2750db38a4046d0938d95d2`;
3.78 s CPU).

The unchanged policy was then applied to two crops already frozen in the local
recovery experiment. `thank-you-for` is distinct content; `know-enough-broad`
overlaps the difficult phrase and tests context width rather than independent
visual generalization. On `thank-you-for`, agreement proposed 5,966 pixels/431
components, including 3,192 pixels below hybrid 0.01, and visibly recovered
coherent middle-phrase structure. The broader context retained the `enough`
effect. This supports same-page transfer only—not cross-page or cross-collection
generalization.

Exact held-out record:
`artifacts/line-conditioned-vector-heldout-v1/003-18860314-L01-01/experiment.json`
(SHA-256
`cd8361638592e9247933fbe148136ba1dbee11161ea2ff61ac7d4dd2f10099c6`;
3.03 s CPU).

### Automatic Kraken line corridors across pages

The same positive–unknown vector policy was next driven by Kraken boundaries
instead of centered hand-frozen rectangles. On each of independent pages 001
and 002, software selected the eligible Kraken lines with low, median, and high
Eynollah p0.50 density. Each boundary was expanded 30 pixels and cropped with a
90-pixel context margin. No line was chosen by visual appeal.

All six corridors centered the intended line and largely excluded adjacent
writing. The vector additions remained concentrated on visible stroke gaps and
shoulders rather than catastrophically flooding the paper. Added-pixel load was
1.70%–7.17% of anchor size on page 001 and 2.70%–21.44% on page 002. The
lowest-density page-002 line received 1,679 additions, including 404 where
hybrid probability was below 0.01, and visibly filled faint portions of the
target line.

The limitation is now sharper: those six proposal masks contain 259–652 added
components per line, and every crop has median four-connected addition area of
one pixel. Kraken geometry therefore appears useful for deciding **where to
search**, but it does not decide **which tiny source fragments belong**. Promote
the automatic corridor as proposal geometry only. Rank anchor-attached or
independently supported groups first; never present hundreds of raw fragments as
individual human decisions.

Exact cross-page record:
`artifacts/kraken-line-vector-crosspage-v1/experiment.json` (SHA-256
`b1fcd2b1deeb37b60155babfe7605511649091376be7b8bcb0995027b01b8230`;
10.36 s CPU).

### Exact-pixel fragment grouping into editable colours

The cross-page proposals exposed a human-interface problem: the ink is often
visually coherent but stored as hundreds of tiny connected components. A
follow-up changed no selected ink at all. It dilated only a temporary grouping
support with three anisotropic kernels, assigned original pixels to resulting
left-to-right groups, and discarded the temporary support. Every output label
map was checked to contain exactly the same anchor-plus-proposal pixels.

Across the same six automatically selected lines:

- tight `3x7` grouping produced 12–30 review groups and often split dots,
  ascenders, or broken letters from their word;
- balanced `5x15` produced 10–22 groups, a 58.33%–92.26% reduction from the
  36–168 raw eight-connected evidence components;
- broad `7x25` produced 7–19 groups but visibly merged neighboring words,
  including `thoroughly enjoying`.

Balanced grouping was visibly word-like on multiple lines: `thoroughly`,
`enjoying`, `yourself`, and `you` frequently became distinct colour groups. It
still merged `forgetful brother` in one case and left isolated speck groups in
others. Promote balanced as an editable first grouping, with tight/broad as
split/merge challengers—not as final ownership. This is a potentially large
human-effort improvement because correction becomes “split/merge/reassign a
colour group” rather than clicking hundreds of fragments, while the eventual
fitted envelope still consumes the exact reviewed ink pixels.

Exact grouping record:
`artifacts/vector-fragment-grouping-v1/experiment.json` (SHA-256
`742b8d5a1179675013a7149a49f03c65c89a4514c34949a536bd55e277620cf5`;
3.36 s CPU).

### Fitted-line gate and required abstention

A RANSAC line was fitted from confident hybrid fragments inside the rough
corridor, using median-y x bins and an asymmetric anchor-residual band. It was
plausible on folded and acknowledgement writing, with slopes `+0.0116` and
`-0.0335`. On `enough`, only five x bins contained anchors; the fit connected
unrelated fragments into slope `-0.1597`, retained only 1,797/7,502 vector
pixels, and visibly deleted most recovered writing.

This rejects unconditional fitted-line clipping. Exact record:
`artifacts/fitted-line-vector-gate-v1/003-18860314-L01-01/experiment.json`
(SHA-256
`0432cc43313d66f80ee3661618033a5154c8448dd069fc4e497132cd7c8d7048`;
1.04 s CPU).

A frozen quality gate required at least eight occupied bins, 60% RANSAC inliers,
absolute slope at most 0.08, and 55% all-crop anchor retention. It rejected the
destructive `enough` fit and preserved all upstream proposals. It accepted the
folded fit and conservatively rejected acknowledgement because all-crop anchor
retention was 54.33%. Promote the abstention behavior; refine retention to use
target-line anchors before using it for precision selection.

Exact quality-gate record:
`artifacts/fitted-line-quality-gate-v1/003-18860314-L01-01/experiment.json`
(SHA-256
`55980ff36faecc7ee21417f76bd3909a08a94fffbbca9f171416bf52578e7949`;
0.69 s CPU).

### Three-tier review surface

Vector-only connected components were ranked by independent local recovery:

- **strong**: at least 10% overlaps one-pixel-dilated conservative recovery;
- **likely**: not strong, but at least 10% overlaps balanced recovery;
- **exploratory**: vector-only; visible but never automatically accepted.

On held-out `thank-you-for`, strong plus likely account for 5,188/5,966 pixels
(86.96%); only 778 pixels remain exploratory. On acknowledgement, strong plus
likely account for 4,953/6,349. On near-erased `enough`, 6,409/7,502 remain
exploratory because the independent recovery method missed the word too. Those
exploratory pixels visibly contain valid word structure, so disagreement must
lower review priority rather than erase evidence.

Exact tier record:
`artifacts/vector-proposal-tiers-v1/003-18860314-L01-01/experiment.json`
(SHA-256
`9884a5874899703a4ab7ad9f7d057f9fa621c086350913db2640eb31926b778d`;
3.40 s CPU).

The resulting interaction policy is:

1. keep the full-page hybrid anchor visible and selected;
2. offer strong green whole components first;
3. offer likely orange components if the word remains incomplete;
4. show exploratory magenta only on demand or when visible source writing is
   still missing;
5. record every component accept/reject with its tier and upstream hashes;
6. fit the deterministic word envelope only after ownership is corrected.

### Research alignment

This result is consistent with, but does not establish the performance claims
of, several primary research directions:

- [PANet](https://openaccess.thecvf.com/content_ICCV_2019/html/Wang_PANet_Few-Shot_Image_Semantic_Segmentation_With_Prototype_Alignment_ICCV_2019_paper.html)
  segments query pixels by matching support-derived class prototypes;
- [positive–unlabeled learning with incomplete annotations](https://arxiv.org/abs/2302.08050)
  treats unlabelled examples as unknown rather than automatically negative;
- [ScribbleSup](https://openaccess.thecvf.com/content_cvpr_2016/html/Lin_ScribbleSup_Scribble-Supervised_Convolutional_CVPR_2016_paper.html)
  combines sparse trusted marks, graphical propagation, and learned segmentation;
- [PixelPick](https://openaccess.thecvf.com/content/ICCV2021W/ILDAV/html/Shin_All_You_Need_Are_a_Few_Pixels_Semantic_Segmentation_With_ICCVW_2021_paper.html)
  shows that carefully selected sparse pixel labels can sharply reduce dense
  annotation effort;
- [unsupervised domain adaptation for document binarization](https://arxiv.org/abs/2012.01204)
  reports that adaptation can help new document domains but can also hurt when
  domains are already similar, supporting an explicit adapt-or-abstain gate;
- [DocBinFormer](https://arxiv.org/abs/2312.03568) and
  [BiNet](https://arxiv.org/abs/1911.07930) are relevant supervised historical
  document binarization baselines for the later trained-model comparison.

The practical implication is stronger than “train a binarizer.” Accepted human
word masks, rejected components, unresolved pixels, and line/word geometry can
train a positive–unknown, page-adaptive proposal model and a separate ownership
model. The current pseudo-seed vector result is a lower bound because its teacher
already misses the target; exact human masks provide much cleaner prototypes and
hard negatives.

## Fragment repair before model reinference

The first bounded repair experiment tested the user's hypothesis directly on the
frozen acting-safe `enough-tight` crop. It treated Eynollah p0.50 pixels as strong
seeds and p0.20 pixels as weaker source evidence, limited repair to the centered
22%–78% line corridor, and compared:

- the unaltered real-context crop;
- the page-ink-vector enhancement baseline;
- source-only 3×7 hysteresis-style reconnect, which strengthens weak Eynollah
  evidence but invents no pixels;
- temporary 3×7 and 5×11 bridges, whose synthetic pixels were hash-bound and
  removed from every projected result.

An initial raw-vector bridge prototype created 16,357 synthetic pixels around
32,446 supported pixels and visibly connected paper texture into a web. It was
rejected before inference. The bounded variants used 7,729 weak-source pixels and
5,544 strong seeds; the tight and broad temporary bridges contained 875 and
2,284 synthetic pixels respectively.

At Eynollah p0.50, source-only reconnect was the balanced winner:

| Input | Faint-proxy recall | Full-page anchor retention | Paper-proxy pixels | Exact-source pixels | Exact-source components |
|---|---:|---:|---:|---:|---:|
| Page-ink vector baseline | 34.77% | 90.65% | 0 | 7,169 | 54 |
| Source-only reconnect 3×7 | **52.17%** | **96.00%** | **0** | **9,529** | **38** |
| Temporary bridge 3×7, projected | 51.76% | 93.26% | 1 | 9,040 | 40 |
| Temporary bridge 5×11, projected | 52.00% | 90.08% | 0 | 8,612 | 46 |

At p0.20, source-only reconnect raised faint-proxy recall from 48.77% to
61.16% and retained 92.85% of the full-page anchor, but activated three pixels
in the conservative paper proxy. This lower threshold therefore remains a
defer/high-recall layer, not the default.

Visual inspection agrees with the measurements: source-only strengthening makes
more of the faint center stroke coherent, while explicit bridges do not cause the
model to recover more exact source ink after the scaffolding is removed. Reject
synthetic bridges and promote source-only reconnect as a bounded preprocessing
candidate. This is not word-ownership proof: neighboring fragments remain at the
crop edges and still require line-conditioned unique ownership or human review.

Exact preparation manifest SHA-256:
`5c0a880f9c33a3870a66543aca23f9b9fa467ac32c91548e6f8034537604ba3b`.
Exact reinference manifest SHA-256:
`dd1354f4d086c4f81daa2d330bd17d4a412dd913ab7c2adf6b90e4ac36257dd6`.
Five model variants ran in 12.59 s CPU after a 3.94 s model load. No sealed human
page or answer was opened.

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
3. Compose full-page hybrid, native-scale CLAHE proposals, source-colour/ridge
   continuity, and fitted-line geometry. Preserve agreement states and abstain
   rather than unioning every layer.
4. Build a seed-driven embedding/graph propagation challenger and compare it
   with the now-frozen local source-colour recovery baseline.
5. Download and hash the current Eynollah 2023 default hybrid checkpoint; repeat
   the exact frozen cohort without changing thresholds or evidence.
6. Add a fourth acting-safe failure page with mixed ink/pencil or severe shadow.
7. Expose hybrid anchor, CLAHE-only candidates, and conservative/balanced local
   additions as distinct
   optional selector layers and measure
   human corrections and seconds per completed word.
8. After enough fully residual-audited pages exist, freeze letter/writer-level
   train/development/test splits and fine-tune the extractor.
9. Use the exact per-word masks to train/evaluate line-local unique ownership;
   keep the fitted envelope deterministic.

The next implementation should be geometry-conditioned hybrid ink, because it
directly addresses the observed high-confidence false objects while retaining
the largest faint-writing improvement measured so far.
