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

1. On the same three pages, intersect hybrid `p0.50` with extracted-page,
   text-region, and fitted-line corridors. Verify that 001's glass rings/page edge
   disappear without erasing ascenders, descenders, signatures, or marginalia.
2. Build a seed-driven page-adaptive graph propagation baseline and compare it
   with unrestricted source-color growth and threshold `0.20`.
3. Download and hash the current Eynollah 2023 default hybrid checkpoint; repeat
   the exact frozen cohort without changing thresholds or evidence.
4. Add a fourth acting-safe failure page with mixed ink/pencil or severe shadow.
5. Expose the best frozen candidate as an optional selector layer and measure
   human corrections and seconds per completed word.
6. After enough fully residual-audited pages exist, freeze letter/writer-level
   train/development/test splits and fine-tune the extractor.
7. Use the exact per-word masks to train/evaluate line-local unique ownership;
   keep the fitted envelope deterministic.

The next implementation should be geometry-conditioned hybrid ink, because it
directly addresses the observed high-confidence false objects while retaining
the largest faint-writing improvement measured so far.
