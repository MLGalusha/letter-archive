# Page 012 missed ink, page-specific reference learning, and adaptive grouping

Date: 2026-08-09
Page: `012-18630108-L01-04`
Evidence boundary: acting-safe source and frozen software outputs only. No completed
human page, human ownership mask, sealed answer, or sealed evaluation raster was
opened or shown to an acting agent.

## Outcome

The page's missing top-left writing is not absent from the source. A page-specific
local-paper ink vector learned from Eynollah's high-confidence strokes visibly finds
the omitted words, including fragments that Eynollah scores below `0.01`. Kraken 7
also locates the full faint line starts in upright source coordinates. The strongest
current composition is therefore:

1. keep Eynollah `p >= 0.50` unchanged as a high-specificity anchor;
2. use losslessly upright Kraken geometry as line/search ownership, never ink truth;
3. compare pixels to Eynollah ink after subtracting nearby paper colour;
4. keep a separate weak review tier rather than blindly unioning it;
5. measure stroke width from the Eynollah core;
6. associate exact core and weak pixels with temporary, stroke-scaled support;
7. discard every temporary bridge and expose left-to-right groups for correction.

On the six-line top-left crop, Eynollah core stroke width was `4.0 px` median,
`5.6 px` at q75, and `6.4 px` at q90. The current review preset uses q90 width,
a `5×35` temporary grouping kernel, and retains `24,646` review additions. It
reduces the evidence to `72` line-owned groups. A wider `5×45` kernel produces only
five fewer groups and wider merge-prone spans, so fewer groups alone does not win.

This is promising acting evidence, not a precision/recall claim. Only sealed
post-freeze evaluation or new human ground truth can establish correctness.

## 1. Why the shifted Eynollah grid did not fix the page

The released model consumes `448×448` tiles. The released stitcher keeps interiors
with a `44 px` margin and advances by `360 px`; it does not average overlapping
predictions. The source-derived missed-candidate anatomy showed a stitch association:
near-zero missed candidates were within `32 px` of a stitch `51.834%` of the time,
versus `31.984%` for selected candidates.

Moving the entire grid by half a stride (`180,180`) proved that crop context matters,
but did not produce a better whole-page mask:

| Measure | Result |
|---|---:|
| original p0.50 pixels | 641,883 |
| shifted-only pixels gained | 60,117 |
| original pixels lost by shifted run | 58,654 |
| predeclared missed-candidate pixels rescued | 5,102 |
| rescued within 32 px of original stitch | 2,387 (46.79%) |
| blind-union source-candidate gain | 10,572 |
| blind-union gain outside source candidate | 49,545 |
| seam-aware source-only gain | 3,608 |
| seam-aware gain outside source candidate | 0 |

The huge gain/loss exchange means the shifted grid moves damage rather than removing
it. The blind union is rejected as an automatic mask. The seam-aware source-only
addition remains a review diagnostic.

Primary manifest:
`artifacts/eynollah-offset-grid-comparison-v1/012-18630108-L01-04/offset-180-180/experiment.json`,
SHA-256 `fc772aa12912ef65125469dae36906a54226a42f18d7e51982d532bf82f139d7`.

## 2. The model-derived search corridor was circular but not sufficient

The first line's recovery corridor started around `x=695` because Eynollah's selected
ink started there, even though visible handwriting began farther left. Inheriting the
robust body margin `x=282` from stronger neighboring lines added `252,587` search
pixels. With all evidence thresholds fixed, it admitted only `22` pixels and zero in
the target crop.

The corridor gate was wrong, but removing it did not recover the words. The source
evidence score itself had to improve.

Manifest SHA-256:
`55329089a61a1909291fc64bd663c97253b0ae9bcb7e4713e373eed550099f43`.

## 3. Eynollah ink as a page-specific reference vector

The bounded crop `[180,80,1700,760]` uses Eynollah `p >= 0.95` as trusted-looking
pseudo-ink. Each pixel is represented by 15 source features:

- LAB residuals from nearby paper at two scales;
- blackhat responses at three stroke widths;
- four dark-ridge scales and their maximum;
- oriented edge coherence.

A shrinkage LDA direction compares those features to interline hard-paper samples.
This is a compact page-specific vector, not a newly trained historical-document
model. The resulting score visibly recovers the omitted `hospital...` line start and
the next line. At the balanced q99.5 threshold it proposes `12,636` additions,
including `7,156` where Eynollah is below `0.01`, but the pixels remain fragmented.

Three negative-seed policies established the calibration tradeoff:

- treating every near-zero Eynollah pixel as paper contaminates the paper class with
  missed writing and makes thresholds too harsh;
- using only perfectly smooth paper creates an unrealistically easy negative class
  and floods paper grain (`92,497` additions at the comparable setting);
- textured interline paper returns to a conservative score similar to the original.

Primary v3 manifest SHA-256:
`e50e1d3fb8bf2693c3b771777e9b3741c8d294e75c7b3b911b6d78c6c3d63668`.

## 4. Hysteresis and page-edge conditioning

Exact-source hysteresis keeps weaker score pixels only when their connected component
contains a stronger reference seed. The q99-from-q99.5 setting proposed `24,349`
additions, including `12,236` at Eynollah `p < 0.01`. The broader q95 setting proposed
`85,489` additions and visibly thickened ink while strengthening paper structure; it
is rejected.

Automatic page segmentation from HSV saturation plus a filled largest component
made page-edge distance explicit. A `12 px` inward guard removed `1,478` review
additions. It never removes the fixed Eynollah anchor. A thin page-edge remnant remains,
so distance is a useful feature rather than a complete semantic classifier.

Manifests:

- hysteresis SHA-256 `6bdf570fa3ae3c1732e5414f9f368c4b9b7548c4c84b444f5715c3f71833b747`;
- boundary guard SHA-256 `5c9bfc076ec88177f935979c70ba1d57573415a46a960d0ca7b664da1d5f62a1`.

## 5. Rejected spatial colour segmentation

GrabCut received definite Eynollah foreground, probable vector foreground, and
definite page/corridor background. One iteration proposed `63,034` additions and
visibly thickened strokes into blobs. Five iterations proposed `707,658` additions
and swallowed most of the page region. Aged paper and faint ink overlap too strongly
for this unconstrained colour-mixture smoothness.

This negative result rejects GrabCut, not spatial structure generally. Spatial
structure must be line-, stroke-, and component-aware.

Manifest SHA-256:
`550a550a51bfbb338dca100754342accf6c90e1dbc4f5e9f4b8be6475db2f356`.

## 6. EXIF orientation and Kraken geometry

The JPEG stores raw `4000×3000` pixels with EXIF orientation `6`. A direct Pillow
Kraken call ignored the displayed orientation and produced an invalid 116-line result.
This run is preserved as a negative control.

`ImageOps.exif_transpose` produced a lossless `3000×4000` PNG whose RGB-pixel
SHA-256 exactly matches OpenCV/Eynollah:
`8d1809fb5a7de000d474d6d8e04352f879b9c5242a7fcfd3c50fda06d64d4f8b`.

Pinned Kraken `7.0.3` with model SHA-256
`77a638a83c9e535620827a09e410ed36391e9e8e8126d5796a0f15b978186056`
found 53 lines in 9.827 s inference after 1.968 s model load. The first six main-body
boundaries begin at x `[371,328,328,324,335,371]`, covering the faint line starts
that Eynollah omitted. Kraken is therefore promoted as search geometry only.

Manifest SHA-256:
`82ddcde07a20d38493e0f33df2bb955336d1f70b02d704856c8a70076cd44344`.

## 7. Stroke-width-adaptive exact-pixel grouping

Stroke width is twice the distance to background sampled on the Eynollah-core
skeleton. Kraken polygons expanded `30 px` are converted into exclusive nearest-
baseline line owners. The association graph contains:

`Eynollah core OR q99 local-reference pixels`.

Groups require an Eynollah or q99.5 reference seed. A temporary anisotropic dilation
connects nearby fragments, but labels are projected back onto exact evidence pixels;
the final mask contains zero temporary bridge pixels.

### Controlled sweeps

Adding all Eynollah core pixels to the connectivity graph reduced groups without
materially changing recovered ink:

| Temporary kernel | Before core in graph | With core in graph |
|---|---:|---:|
| 3×11 | 277 | 187 |
| 5×17 | 173 | 128 |
| 5×19 | 149 | 115 |

With vertical reach fixed at `5 px`, the horizontal sweep produced:

| Kernel | Groups | Review additions | Interpretation |
|---|---:|---:|---|
| 5×27 | 88 | 24,611 | still visibly fragmented |
| 5×35 | 72 | 24,646 | current review preset; about 12 groups/line |
| 5×45 | 67 | 24,666 | only five fewer groups; wider merge-prone spans |

The `5×35` mask adds `5,512` pixels at Eynollah p0.20–0.50, `7,552` at p0.01–0.20,
and `11,582` below p0.01. These are proposal bands, not recovered-truth counts.

Primary `5×35` manifest SHA-256:
`1bc4d60ec58477e623b38358cde636e0e9d87bc4dabd279a6e1b422ac91b6c1d`.

## 8. Eynollah-taught group triage

The next experiment froze the `5×35` exact-pixel result and changed no mask
pixel. It fitted a robust one-class prototype to substantive groups containing
Eynollah core. Six group-level features describe density, exact-pixel `2A/P`
thickness, local-reference score, and source darkness residual. The model ranks
wholly new groups by similarity to those page-specific positive examples; its score
is a review ordering, not a calibrated probability.

The 72 groups separated as follows:

| Review lane | Groups | Exact pixels | Meaning |
|---|---:|---:|---|
| Eynollah-anchor-backed | 54 | 75,199 | Contains at least one fixed core pixel; still reviewable, not truth. |
| Substantial faint candidate | 5 | 293 | Wholly new and large enough to inspect. |
| Needs wider context | 2 | 282 | Wholly new but reaches the bounded crop edge. |
| Micro-fragment | 10 | 35 | Fewer than eight exact pixels; retained but deprioritized. |
| Elongated-risk | 1 | 13 | Unusually long and thin; retained as likely structure/noise risk. |

This supports the proposed division of labor. Eynollah does not need to recover a
whole word. One trustworthy part can anchor a page-calibrated fragment association
that recovers the rest. The hard residual case is a word with zero Eynollah core;
only those groups need a second detector, wider context, or focused human review.

Manifest SHA-256:
`3c8444c8b34119fa6be010019f4bb2fa7838412eaa2a8eaddafca129c219313e`.

### ML techniques that fit this evidence model

1. **Positive–unlabeled learning:** Eynollah core is positive; unselected pixels are
   unknown, not background. Only safe interline paper supplies negative examples.
   The current 15-feature shrinkage-LDA reference is the lightweight first version.
2. **Graph/label propagation:** propagate an anchor label only through source pixels
   with similar ink features and plausible stroke/line adjacency. Scribble-supervised
   segmentation uses the same general idea of propagating sparse trusted labels
   through a graphical model ([ScribbleSup](https://arxiv.org/abs/1604.05144),
   [kNN label propagation](https://arxiv.org/abs/2002.05708)).
3. **One-class metric learning:** learn the distribution of trusted ink or
   anchor-backed fragment groups and rank new fragments by similarity. The group
   triage experiment is a transparent robust-prototype version of this idea.
4. **Teacher–student training:** once human corrections accumulate, train a student on
   genuine masks while retaining Eynollah as a conservative teacher. Do not train
   Eynollah misses as background. Confidence-filtered self-training is relevant, but
   human hard negatives are necessary to control paper/fold false positives.
5. **Collection/domain adaptation:** adapt a trained binarizer to each collection's
   paper, imaging, and ink distribution. Published document-binarization work finds
   domain adaptation useful but also warns that adaptation can hurt when domains are
   already similar ([Castellanos et al.](https://arxiv.org/abs/2012.01204)).

The next neural model should therefore predict three states during training:
`ink`, `paper`, and `unknown/ignore`. It should use line-conditioned crops and losses
for thin structures, while evaluation must jointly measure recovered ink, foreign
ink, ownership corrections, and human time.

## What the result means

### Supported

- Eynollah behaves usefully as a clean anchor and page-specific ink teacher.
- Its omissions are not explained only by intensity or only by tile seams.
- Kraken and Eynollah provide complementary evidence: Kraken finds line extent;
  Eynollah supplies high-specificity pixels.
- Learned stroke thickness is a useful scale parameter for fragment association.
- Exact-pixel grouping can reduce correction burden without manufacturing ink.

### Not supported yet

- formal Eynollah precision or recovered-ink recall;
- automatic promotion of the vector additions to training truth;
- automatic word ownership from 72 coloured groups;
- automatic rejection of all page edge, folds, stains, and paper grain;
- a universal `5×35` kernel across collections, resolutions, or writers.

## Next bounded experiments

1. Repeat the frozen q90/`5×35` grouping and one-class triage on at least two
   independent pages before promoting a default.
2. Derive rough word intervals from along-line valleys and compare them with the
   72 groups. Use split/merge/reassign actions rather than forcing one group per word.
3. Test a positive–unlabeled pixel classifier against the current LDA reference with
   thresholds frozen before sealed evaluation.
4. Once new human fitted ownership data exists, freeze a held-out set and evaluate
   ink recall, foreign ink, correction actions, and time together.
