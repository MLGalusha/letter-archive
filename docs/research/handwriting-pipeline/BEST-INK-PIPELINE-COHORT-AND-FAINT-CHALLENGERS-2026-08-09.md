# Best ink pipeline cohort and faint-ink challengers

Date: 2026-08-09

Evidence visibility: acting-safe source pages and software-derived proxies only

Sealed completed human page opened: no

## Outcome

The strongest current architecture is asymmetric:

1. run the frozen 2022-08-16 SBB/Eynollah hybrid model once and preserve its
   probability, not only a hard mask;
2. use `p>=0.50` as a clean semantic-foreground core;
3. expose `0.20<=p<0.50` as a separate model-support tier inside text/line
   geometry rather than silently unioning it everywhere;
4. when a word is visibly incomplete, enhance only its real-context crop using
   the page-learned ink direction;
5. use the already-promoted source-only reconnect and one-pass vector/local
   composition as the primary missing-ink proposal;
6. use independent Su/local-contrast, multi-window Sauvola, multiscale
   blackhat, and Retinex evidence to rank or challenge those pixels;
7. retain exact source pixels only, group them for interaction, select semantic
   ownership, and then run the deterministic fitted-envelope algorithm.

The full-page cohort demonstrates that Eynollah already extracts coherent ink
on easy, folded, dense, mixed-density, and surprisingly faint brown pages. The
same cohort also proves it is not handwriting truth: on page 001 it confidently
extracts glass rings and a page edge, and on page 014 it retains some external
background/fold structure. Geometry and semantic ownership therefore remain
mandatory.

## Frozen seven-page cohort

The cohort was frozen before new inference. Its manifest is:

`/Users/masongalusha/Workspace/projects/letter-archive-word-envelope-shrink-wrap-poc/experiments/word-envelope-shrink-wrap-poc/artifacts/best-ink-pipeline-cohort-v1/cohort.json`

SHA-256: `de01554774f58f810ec145ac62953612d319b91a394fb76389c361ddfcc368b4`

| Page | Frozen role | Core pixels | p0.20 support | Source recovery | Composed clean | Visual finding |
|---|---|---:|---:|---:|---:|---|
| 001-18881103-L01-01 | hard clutter + faint | 248,610 | 36,475 | 1,288 | 286,373 | Writing is coherent, but rings/page edge remain false semantic foreground. |
| 002-19001113-L01-02 | folded handwriting | 316,640 | 33,032 | 1,440 | 351,112 | Strong recall across folds; visually clean at page scale. |
| 003-18860314-L01-01 | extreme faint development | 281,535 | 46,807 | 13 | 328,355 | Stronger strokes are clean; near-erased portions still need local recovery. |
| 014-18780127-L01-04 | fold/stain/clutter | 150,907 | 15,023 | 60 | 165,990 | Dense handwriting is excellent; some paper-edge/external structure remains. |
| 012-18630108-L01-04 | extreme faint brown spread | 641,883 | 134,545 | 89 | 776,517 | The model performs much better than source appearance suggests; right-page fragments remain. |
| 013-19441223-L01-03 | mixed density + stain | 854,476 | 45,965 | 2 | 900,443 | Near-complete clean handwriting; stain largely suppressed. |
| 009-19470827-L01-03 | easy typewritten control | 1,005,458 | 136,354 | 96 | 1,141,908 | Clean typewriting extraction with minor page-boundary evidence. |

Full result manifest SHA-256:
`214e646c2864e2ea680d17974812124239009008feb6541a6b0f2c1359dd4f91`.

The initial all-in-one execution is explicitly rejected. Loading TensorFlow and
then constructing several full-resolution float feature maps on 12-megapixel
pages overloaded an 8 GiB machine. The safe execution contract is now:

- one model-only page process, observed peak RSS about 1.1 GiB on the sampled
  12-megapixel pass;
- process exit and memory release;
- one model-free source-recovery page process;
- process exit and memory release;
- never reserve a multi-gigabyte RAM disk for both runtime and model.

The first model-free full-page source gate is also rejected as too conservative.
It added only 13 exact source pixels on page 003. Preserve its masks as a useful
negative result; do not describe it as the best faint recovery.

## Near-erased word challenger

Frozen crop: page 003 `enough-tight`, `[2050,2100,600,300]`.

Experiment manifest:

`/Users/masongalusha/Workspace/projects/letter-archive-word-envelope-shrink-wrap-poc/experiments/word-envelope-shrink-wrap-poc/artifacts/faint-ink-classical-challengers-v1/003-18860314-L01-01/enough-tight/experiment.json`

SHA-256: `1fc1dd2228bba3c908a774c02211a90b420881f821bc9f4788f86bd3fa2ee010`

All method families and constants were fixed before proxy measurement. The
faint and paper masks are prior software proposals, not human truth.

| Candidate | Exact pixels | Components | Faint proxy | Paper proxy pixels | Interpretation |
|---|---:|---:|---:|---:|---|
| Full-page Eynollah p0.50 | 3,176 | 19 | 0.00% | 0 | Clean anchor, misses the erased word. |
| Source-reconnect Eynollah p0.50 | 9,529 | 38 | 52.17% | 1 | Strong coherent partial recovery. |
| Prior one-pass composition | 9,695 | 164 | 100.00% | 1 | Best current proxy balance; still needs ownership grouping. |
| Su-inspired local contrast | 7,970 | 258 | 79.58% | 2 | Strong independent confirmation of the faded word. |
| Multi-window Sauvola | 7,108 | 322 | 71.82% | 1 | Cleaner than blackhat but fragmented. |
| Multiscale blackhat | 12,254 | 604 | 95.46% | 43 | High recall with visible speckle; challenger only. |
| Multiscale Retinex z | 39,175 | 2,506 | 100.00% | 6,491 | Catastrophic paper-texture flooding; reject as extractor. |
| New four-method conservative composition | 12,067 | 155 | 83.79% | 3 | Coherent, low-clutter independent proposal. |
| New four-method balanced composition | 14,659 | 296 | 97.60% | 12 | Useful high-recall review tier; more fragments. |

The important result is not that the new composition beats the prior one-pass
mask—it does not. It provides independent evidence. Pixels selected by both the
page-vector pipeline and classical contrast/shape consensus can be shown as
higher-confidence selectable ink; pixels unique to either route remain separate
review tiers. This is safer than taking a union and gives a human or acting agent
fewer ambiguous decisions.

## What the experiment says about faint ink

- Re-running the same model at lower thresholds has diminishing returns when
  the model assigned near-zero probability to the writing.
- Page-specific color enhancement can move real faint strokes into the model's
  learned distribution, but the best result still requires exact-source
  recovery after the model.
- Slow illumination correction alone is dangerous. Retinex makes the word
  visible but also makes paper texture look like strokes.
- Local max-min contrast is unusually useful here because it is less sensitive
  to broad illumination changes than raw grayscale darkness.
- Morphological blackhat is an effective high-recall detector across stroke
  widths, but it needs independent agreement to suppress paper speckle.
- A rough line/word corridor is essential. Every source algorithm will collect
  neighboring-line ink if the geometry is broad.

## Primary research routes

The tested fixed-window Sauvola consensus is a classical approximation, not the
trained SauvolaNet. SauvolaNet learns pixelwise window attention and adaptive
threshold parameters in a roughly 40K-parameter network, and the authors report
evaluation on thirteen document-binarization datasets. Its official runtime is
TensorFlow 1.15/Keras 2.2.4, so it should be ported or isolated before testing,
not installed into the active application environment:

- paper: https://arxiv.org/abs/2105.05521
- official code and pretrained models: https://github.com/Leedeng/SauvolaNet

The Su/Lu/Tan family motivates local maximum/minimum contrast plus stroke-edge
evidence under uneven illumination. The bounded challenger implements the local
contrast principle but not their full published pipeline:

- DOI: https://doi.org/10.1109/TIP.2012.2231089

Howe's Laplacian-energy method combines local Laplacian likelihood, Canny edges,
and a graph-cut objective. A faithful graph-cut challenger remains untested and
is a good next bounded experiment on the same frozen crops:

- DOI: https://doi.org/10.1109/ICDAR.2011.11

Promising later model challengers should remain separate rather than replacing
the current extractor without cohort evidence:

- UDBNET uses unsupervised adversarial texture augmentation and generated
  degraded/clean pairs: https://arxiv.org/abs/2007.07075
- DocRes treats binarization, deshadowing, defading, deblurring, and appearance
  enhancement in one restoration model: https://openaccess.thecvf.com/content/CVPR2024/html/Zhang_DocRes_A_Generalist_Model_Toward_Unifying_Document_Image_Restoration_Tasks_CVPR_2024_paper.html
- cycle-consistent diffusion enhancement offers an unpaired-data route when
  exact clean/faded pairs do not exist: https://openaccess.thecvf.com/content/WACV2024/html/Zhao_DECDM_Document_Enhancement_Using_Cycle-Consistent_Diffusion_Models_WACV_2024_paper.html

If the archive can rescan selected failures, multispectral or near-infrared
capture is a materially different avenue: it can separate ink and support using
spectral response that RGB processing cannot recover. It is not a software-only
fix for existing JPEGs.

## Next bounded sequence

1. Bind independent Kraken line geometry into the seven-page boards so rings,
   page edges, and external structures can be separated without clipping
   legitimate strokes.
2. Turn the faint challenger into a confidence intersection: vector-only,
   classical-only, and agreement tiers; do not union them.
3. Run the unchanged challenger on `acknowledgement-tight`, folded writing, and
   two frozen crops from page 012.
4. Implement a faithful edge-seeded graph-cut challenger on those same crops.
5. Isolate or port SauvolaNet and compare its probability/threshold output using
   the same multi-objective visual and proxy report.
6. Once human fitted masks accumulate, use them for post-freeze pixel evaluation
   and fine-tuning, keeping extractor quality separate from word ownership and
   fitted-envelope safety.
