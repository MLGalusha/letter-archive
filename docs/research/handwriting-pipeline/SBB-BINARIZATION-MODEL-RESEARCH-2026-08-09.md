# SBB binarization model research and Letter Archive training direction

Date: 2026-08-09

## Outcome

SBB Binarization is a strong candidate for the **pixel-evidence extractor**, not a
complete word-localization or ink-ownership solution. The released 2021 model is
conservative on the acting-safe faint page: what it keeps is coherent, but whole
low-contrast word portions can receive almost no foreground probability.

The recommended system has two learned responsibilities and one deterministic
finisher:

1. an ink model produces calibrated foreground probability and uncertainty;
2. a line-conditioned word-ownership model assigns candidate ink to ordered word
   instances, transfers disputed components, and may abstain;
3. the existing fitter derives the final tight box/envelope from the accepted
   per-word mask.

The second model should not learn to draw a rectangle around a rough crop. It
should learn **which source pixels belong to which word**. Once ownership is
correct, fitted geometry is a deterministic calculation and is already one of
the strongest parts of the pipeline.

This research used only acting-safe source and software evidence for page
`003-18860314-L01-01`. No completed human page, sealed ownership mask, or sealed
evaluation board was opened.

## The exact checkpoint that was tested

The tested weights are the official `saved_model_2021_03_09` release used through
`sbb-binarization==0.1.0` under TensorFlow/Keras 2.12.

Direct inspection of the saved model established:

- input: `224 × 448 × 3` patches;
- output: `224 × 448 × 2` softmax probabilities;
- parameter count: `38,211,210`;
- 212 Keras layers: 60 convolutions, 60 batch-normalization layers, 56
  activations, 16 residual additions, five upsampling and five skip-concatenation
  layers;
- no transformer or attention layer is present;
- channel 1 is the foreground/ink class.

The current SBB model card describes a newer hybrid CNN–Transformer
ResNet50/U-Net model. That description must not be retroactively attached to the
2021 checkpoint we tested. The exact checkpoint is a ResNet-50-style convolutional
encoder with an upsampling/skip decoder.

The released inference code throws away useful information. It takes `argmax`
across the two softmax channels for each pixel, stitches hard labels, and returns
one-bit black/white output. It does not retain probabilities or uncertainty.

Sources:

- [SBB model card](https://huggingface.co/SBB/sbb_binarization)
- [SBB inference repository](https://github.com/qurator-spk/sbb_binarization)
- [Official 2021 model release](https://github.com/qurator-spk/sbb_binarization/releases/tag/v0.0.11)

## What is known about SBB training

The current SBB family model card reports a mixture of:

- earlier DIBCO competition training sets;
- the Palm Leaf dataset;
- the Persian Heritage Image Binarization Competition dataset;
- pseudo-labelled Berlin State Library images, with those datasets listed as
  not yet published;
- a specially created set of very dark and very bright images.

It reports batch size 8, learning rate `1e-4`, 20 epochs, soft Dice loss, flips,
scaling and blur augmentation, checkpoint selection on difficult SBB documents,
and an ensemble of selected weights.

This is useful family-level provenance, but it is not a fully reproducible
training ledger for the exact 2021 file hash. The current card and the observed
2021 architecture disagree about transformer use, and the pseudo-labelled SBB
corpus is not published. We should therefore treat the exact original data mix,
split, label policy and checkpoint selection for the tested file as only
partially known.

The maintainers now provide training documentation in Eynollah. It supports
binary pixel labels, CNN-only or CNN–Transformer backbones, patch training,
weighted loss or soft Dice, augmentation, checkpoint continuation and model
ensembling. The current training code can load an existing model for continued
training. A maintainer also recommends pseudo-labelling satisfactory SBB output
and manually correcting/cropping locally good predictions.

Sources:

- [SBB training data and procedure](https://huggingface.co/SBB/sbb_binarization/blob/main/README.md#training-details)
- [Eynollah training documentation](https://github.com/qurator-spk/eynollah/blob/main/docs/train.md)
- [SBB fine-tuning discussion](https://github.com/qurator-spk/sbb_binarization/issues/64)

## Bounded probability experiment

Artifact root:

`/Users/masongalusha/Workspace/projects/letter-archive-word-envelope-shrink-wrap-poc/experiments/word-envelope-shrink-wrap-poc/artifacts/sbb-probability-sweep-20260809/003-18860314-L01-01`

Primary manifest SHA-256:

`01b1d2e6c3d3236abb5349176c3e604b97576a0615d5f4288cb5f87405f9210c`

The experiment reproduced the released hard output with **zero disagreement
pixels** at foreground probability `0.50`, proving that the probability stitcher
matches the released inference path.

| Foreground threshold | Selected pixels | Components | Added versus prior threshold |
| ---: | ---: | ---: | ---: |
| 0.50 | 125,678 | 207 | — |
| 0.40 | 132,881 | 220 | 7,203 |
| 0.30 | 140,941 | 207 | 8,060 |
| 0.20 | 150,848 | 234 | 9,907 |

Moving from 0.50 to 0.20 added 25,170 pixels, a 20.03% increase over the released
mask. At full-page and main-body review scale, most additions thicken or reconnect
existing strokes and restore small marks without suddenly selecting the ruled
paper or fold. However, the lower threshold still does not recover complete faint
words that the model assigned near-zero probability.

Decision:

- preserve the probability map instead of only the one-bit result;
- do not promote `0.20` as a global default from one page;
- use probability bands as evidence inside line/word geometry;
- separately recover candidate pixels that SBB scores near zero, using source
  color growth or a challenger model;
- evaluate threshold bands by target continuity, contamination, residual misses,
  and correction effort—not selected-pixel count alone.

Important files:

- `experiment.json` — exact paths, hashes, model geometry, thresholds and timing;
- `foreground-probability.float16.npy` — preserved foreground probability;
- `probability-threshold-board.png` — full-page threshold comparison;
- `main-body-threshold-review.png` — source, 0.50, 0.20 and addition overlay;
- `source-overlay-p050-core-p020-additions.png` — cyan 0.50 core and red 0.20
  additions;
- `scripts/experiment_sbb_probability_sweep.py` — reproducible runner.

## Limitations that explain the observed misses

### Local patch context

The tested model sees only a `224 × 448` patch. The SBB card explicitly warns
that patchwise segmentation cannot capture long-range dependencies. It cannot use
the full baseline, neighboring word rhythm, reading order or repeated writer
appearance to decide that a nearly invisible stroke is probably text.

### Binary objective

Foreground/background training forces ambiguous faint strokes into one class.
It provides no explicit class for uncertain ink, ruled lines, folds, bleed-through
or non-text marks. The released `argmax` then hides how close a decision was.

### Domain shift

DIBCO and historical-document mixtures are broad, but Letter Archive contains a
particular distribution of faint graphite/ink, photographed paper, folds, ruling,
exposure, writers and camera geometry. The result can be very precise on dark
strokes while missing a whole faint word on the same page.

### Pseudo-label inheritance

Pseudo-labels expand scale cheaply but preserve teacher omissions. If a teacher
misses the faintest writing and an unlabeled pixel is treated as background, the
student learns the same blind spot. Pseudo-labels need provenance, confidence and
an ignore/unknown state.

### It is not OCR or ownership

SBB does not read text and cannot distinguish two touching words, assign a dot or
cross-stroke to its word, identify an omitted token, or decide whether a signature
is one or several semantic units. Its own card says it is image-to-image and does
not perform OCR.

### Old runtime and incomplete reproducibility

The 2021 SavedModel is not directly loadable by Keras 3; the successful trial
required TensorFlow/Keras 2.12. The family training tooling now exists, but the
exact 2021 weight hash lacks a complete public training manifest and source-dataset
snapshot.

## Data we should gather

The human workspace is already collecting a richer target than a binary
binarization dataset. Each completed page should durably yield:

- upright source image and source SHA-256;
- orientation/source transform;
- one exact mask per semantic word;
- an integer owner map derived from those masks;
- union handwriting mask derived from every completed word mask;
- non-word handwriting classes where useful: signature, marginalia, page number,
  flourish or unresolved mark;
- explicit `ignore/ambiguous` mask;
- residual audit status proving whether the page is complete;
- derived tight boxes/envelopes, line IDs and reading order;
- human correction actions and elapsed time;
- model/proposal versions and hashes that preceded correction;
- immutable collection, letter, page and writer grouping keys;
- fixed train/development/test split assignment.

The most important labeling rule is: **an unfinished page is not binary negative
ground truth**. Unselected pixels on a partially annotated page must be unknown,
not background. Training on partial work as background would directly teach the
model to erase the words the human has not reached yet.

### Split policy

Do not randomly split patches. Patches from one letter share paper, exposure,
writer and scan conditions and would leak into both train and test.

Split by whole letter and preferably by writer/collection. Maintain:

- a development set for frequent visual iteration;
- an unseen letter/writer set for generalization;
- a sealed final set that is never used for threshold or checkpoint selection.

### What to prioritize

Prioritize diversity and failure value over easy-page volume:

- very faint words and mixed dark/faint lines;
- pencil versus ink;
- folds, ruled lines, stains and bleed-through;
- rotated margins, signatures and page edges;
- disconnected dots/cross-strokes and long flourishes;
- touching neighboring words;
- pages on which SBB and source-color recovery disagree.

Use active learning: rank unlabelled pages and crops by model disagreement,
uncertainty, residual ink and expected human correction cost. Do not select only
pages where SBB already looks good.

### Practical volume targets

These are planning estimates, not promises:

- 20–50 diverse, completely audited pages can support a first fine-tuning
  feasibility test;
- 100–300 diverse complete pages should make a much more credible domain model;
- training a new large extractor from scratch would require far more independent
  pages and is not the sensible first move.

Thousands of patches cut from 20 pages are still only 20 independent pages.

## Recommended model architecture

### Stage A — calibrated ink evidence

Start from the 2021 model or a modern challenger and output:

- foreground probability;
- calibrated uncertainty;
- optionally three classes: likely handwriting, ambiguous/faint evidence, and
  background/non-handwriting.

Train with a combination of Dice/Tversky-style foreground loss, calibrated
cross-entropy, boundary/continuity supervision and an ignored ambiguous class.
Augment exposure, color, blur, compression, shadows, paper texture and
bleed-through while transforming labels exactly.

SBB should remain the first baseline, but it should not be the only challenger.
A fair comparison study found different winners on different held-out DIBCO
years: DE-GAN, DP-LinkNet, 2-StageGAN and SauvolaNet each won a different test
set. That heterogeneity argues for evaluating several models on our own sealed
Letter Archive split instead of choosing by reputation.

Sources:

- [Fair document-binarization comparison](https://arxiv.org/abs/2401.11831)
- [Reproducible model collection](https://github.com/RichSu95/Document_Binarization_Collection)
- [SauvolaNet paper](https://arxiv.org/abs/2105.05521)
- [SauvolaNet implementation](https://github.com/Leedeng/SauvolaNet)

### Stage B — line-conditioned word ownership

Use the excellent Kraken/fitted baselines as a coordinate frame, then predict
word ownership inside each line rather than generic page rectangles. Viable
outputs include:

- word-center heatmaps plus horizontal boundary probabilities;
- per-pixel instance embeddings grouped left-to-right;
- center/offset vectors that point each ink pixel toward its word;
- ordered word slots with per-slot masks;
- component-to-word scores with a globally unique assignment ledger.

The existing research already shows why unique assignment matters: first-touch
order is unstable, while global exclusive ownership and explicit transfers are
more reliable. The ownership model should receive source pixels, Stage-A
probability bands, line/baseline geometry, rough Kraken proposals and optionally
transcript token count/context. It must be allowed to leave evidence residual or
ambiguous.

### Stage C — deterministic fitted geometry

Given an accepted word mask, derive the tight fitted box/envelope with the
existing shrink-wrap algorithm. Store both the mask and derived geometry. Boxes
alone throw away the supervision needed to improve extraction and ownership.

### Single multi-task model later

A shared encoder with heads for ink, baselines, word centers/boundaries and
instance ownership may eventually outperform a modular pipeline. It is not the
best first training project because errors become harder to localize and the
current dataset is small. Preserve the conceptual stage boundaries and metrics
even if implementation later shares a backbone.

## Evaluation that matches the actual product

Keep standard binarization measures such as precision, recall, F-score, pseudo
F-measure and DRD, but do not select a checkpoint on one pixel metric.

Measure at least:

- complete-word recall, not only aggregate pixel recall;
- stroke fragmentation and connected-component explosion;
- contamination from folds, ruling, neighboring words and non-text;
- word-owner accuracy and duplicate claims;
- residual target and residual foreign ink;
- fitted-envelope coverage and excess area;
- abstention/calibration quality;
- human correction time, clicks/gestures and words completed per minute;
- performance by writer, collection, degradation and page role.

The human-effort metrics matter commercially: a model that is slightly worse in
pixel F-score but produces quickly correctable, coherent instances may be the
better data engine.

## Next bounded experiments

1. Run the preserved probability sweep on several acting-safe pages spanning
   dark, faint, ruled, folded and rotated conditions. Freeze per-page outputs
   before any human evaluation.
2. Compare raw global thresholds with line/rough-word-conditioned thresholds.
   A lower threshold may be safe inside a word corridor and unsafe globally.
3. Use the 0.50 SBB mask as a high-confidence core and grow only through source
   colors supported by the 0.20 probability band, then compare against unrestricted
   source-color growth.
4. Add one complementary challenger, initially SauvolaNet or a model from the
   fair-comparison collection, and evaluate union, intersection and disagreement
   bands without assuming more recovered pixels are better.
5. Export only fully residual-audited human pages into a versioned training
   dataset with owner, union-ink and ignore masks.
6. Fine-tune a binary/three-state extractor before training from scratch.
7. Train the first line-conditioned ownership baseline from exact word masks and
   compare it with deterministic unique component assignment.

The immediate engineering priority is to expose probability/uncertainty and make
human annotations training-safe. The immediate modeling priority is extractor
fine-tuning. The first ownership model should follow once enough complete
per-word masks exist to evaluate it honestly.
