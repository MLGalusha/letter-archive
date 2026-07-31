# Future Ideas: Archive-Specific HTR and Contextual Transcription

**Status:** Research and future implementation ideas. Nothing in this document
should be treated as implemented or approved production behavior.

**Captured:** July 30, 2026

## Goal

Make AI-generated transcripts as easy and safe as possible for an administrator
to verify against the original letter.

The ideal system should:

- connect each transcript line to the correct place in the image;
- keep one mistake from shifting every line that follows;
- make faint, sideways, split, or unusual handwriting easier to inspect;
- distinguish the writer's letter from page numbers, printed stationery,
  neighboring pages, stamps, and other visible text;
- expose uncertainty instead of silently inventing a connection;
- turn human corrections into trustworthy future training data.

## The Important Model Distinction

Kraken uses separate models for two different problems.

### Segmentation model: where is the text?

The segmentation model finds:

- text lines and their baselines or polygons;
- regions such as body text and marginalia;
- potentially different line or region classes;
- the geometry needed to crop and display text.

If segmentation misses a line completely, a normal line-recognition model has
nothing to read.

### Recognition model: what does each detected line say?

The recognition model receives an already-detected line and transcribes that
line. Its output remains associated with the input line.

Conceptually:

```text
Page image
  -> segmentation
  -> segment S1 with geometry
  -> recognition reads S1
  -> S1 now has geometry, OCR text, and confidence
```

The difficult relationship in this project is not connecting Kraken's OCR to
Kraken's segment; Kraken already preserves that association. The difficult
relationship is connecting the page-level LLM transcript to the correct Kraken
segment or group of segments:

```text
LLM transcript line T12
  -> matching and alignment
  -> Kraken segments S18 + S19 + S20
```

## Opportunity: An Archive-Specific Recognition Model

An archive-specific English handwriting recognition model could be
substantially better than a broad generic model because it can learn:

- the actual writers represented in the archive;
- the archive's time period and vocabulary;
- English spelling, names, abbreviations, and place names;
- recurring stationery and scanning conditions;
- the archive's chosen transcription conventions.

Better line OCR would strengthen the alignment system by creating much clearer
textual fingerprints. It could help:

- join several Kraken fragments that form one physical line;
- recover after an uncertain or missing line without shifting the suffix;
- distinguish letter content from printed text absent from the LLM transcript;
- identify likely mistakes in the page-level LLM transcript;
- show useful words instead of OCR gibberish during human review;
- support approximate word- or character-level forced alignment.

Better recognition does **not** by itself fix missing segments, page isolation,
sideways orientation, or reading order. Those remain segmentation and layout
problems.

## Fine-Tuning Versus Training From Scratch

The recommended research sequence is:

1. Establish a frozen evaluation set.
2. Measure the current generic recognition model.
3. Fine-tune a suitable pretrained model on confirmed archive data.
4. Measure improvement as the dataset grows.
5. Train the same architecture from random initialization as a controlled
   comparison.
6. Consider a new architecture or Kraken plugin only after simpler experiments
   establish what the current architecture cannot solve.

Fine-tuning will probably be the strongest early result because it preserves
general knowledge of Latin-script handwriting. Training from scratch becomes
more plausible as the archive accumulates a large and diverse ground-truth
dataset.

"Our own model" does not require inventing a neural architecture. A
domain-specific dataset, trained weights, model card, reproducible experiment,
evaluation, and deployment already constitute a meaningful custom model.
Training from scratch can still be included as an important comparison and
resume project.

## The Training-Data Flywheel

A page transcript is not automatically recognition training data. A trustworthy
recognition example needs:

- an exact line crop, baseline, or polygon;
- the exact text belonging to that line;
- human confirmation that the geometry and text correspond;
- useful metadata such as writer, collection, date, orientation, and image
  quality.

The review interface can gradually produce both types of training data:

| Human action | Future training value |
|---|---|
| Confirms or corrects line text | Recognition ground truth |
| Confirms transcript-to-segment connection | Reliable crop/text pair |
| Merges or splits detected boxes | Segmentation correction |
| Moves a baseline or polygon | Geometry annotation |
| Marks marginalia, stationery, or a page number | Layout-class annotation |
| Marks sideways text and rotation | Orientation annotation |

Only human-confirmed examples should enter the gold training set. LLM output can
be used as a proposed or pseudo-label, but it must not silently become ground
truth.

### Implemented geometry-annotation foundation

The July 2026 review milestone now records trustworthy geometry correction
history without treating it as recognition ground truth:

- every persisted outline has a stable ID and is labeled as machine-created,
  human-created, or human-adjusted;
- actual shape changes create immutable page-geometry revisions with actor,
  time, source-image identity, parent-segment lineage, and a change summary;
- the first edit to legacy revision-zero geometry preserves that original
  machine snapshot before creating revision one;
- page approval is bound to the exact geometry revision and checksum, and any
  later shape edit reopens the page for review;
- full line-segment checksums prevent stale tabs from overwriting mappings,
  classifications, exclusions, or OCR metadata even when the geometry itself
  did not change;
- newly drawn human outlines participate in a derived transcript-alignment
  order without rewriting Kraken's canonical provider order. Rough OCR and
  already mapped text anchor the surrounding lines, while page position,
  region, and column/lane constrain which previously unlocated transcript row
  the new outline may fill;
- a human outline may replace weak evidence such as non-transcribed printed
  stationery, but it does not displace a stronger established text match.

This is the audit trail needed for a future dataset exporter. It deliberately
does **not** yet declare a crop/text pair as gold recognition data: that still
requires an explicit, human-confirmed transcript-to-geometry decision.

## Hybrid Full-Page and Contextual-Crop LLM Transcription

Using isolated line crops for every LLM transcription would lose valuable
context. Using only the full page can make small or faint handwriting visually
indistinct. The strongest likely design combines both.

### Proposed flow

```text
Original page
  -> full-page LLM draft for meaning and continuity
  -> Kraken segmentation and line OCR
  -> initial transcript-to-line alignment
  -> targeted LLM rereading for uncertain locations
  -> consensus or focused human review
```

### Input for a targeted rereading

For an uncertain target line, give the LLM:

1. a high-resolution crop of the target;
2. a wider crop containing the previous and next physical lines;
3. optionally, the full page with the target region highlighted;
4. preceding and following transcript text clearly labeled as context rather
   than ground truth.

A sliding three-line image window is likely more reliable than an isolated crop
because handwriting interpretation often depends on the surrounding sentence.

### Avoiding anchoring and fabrication

Do not initially ask, "The draft says X; is that correct?" That encourages the
model to agree with the hypothesis.

Prefer:

1. ask for an independent visual reading of the crop;
2. compare that reading with the page-level LLM transcript and local HTR;
3. use agreement as evidence;
4. show disagreements and alternatives to the human.

Example:

```text
Page-level LLM: "haven't heard from"
Local HTR:       "haven t heard from"
Crop LLM:        "haven't heard from"

Outcome: strong proposed connection
```

```text
Page-level LLM: "[illegible]"
Local HTR:       "My dear Sadie"
Crop LLM:        "My dear Sadie"

Outcome: propose a correction, but require human confirmation
```

### Targeted use is preferable

Do not spend extra calls on every easy line. Use contextual crop calls for:

- weak or contradictory alignments;
- apparent missing lines;
- split or merged segments;
- faint handwriting;
- marginal or sideways text;
- disagreement between local OCR and the page transcript.

## Sideways and Unusual Text

For a suspicious marginal crop:

1. preserve its original coordinates;
2. try 0°, 90°, 180°, and 270° views;
3. run recognition or a targeted LLM read on each;
4. transform any accepted geometry back to the original page;
5. preserve unmatched text as a review item rather than forcing it into the
   body transcript.

Full-page context remains useful because a sideways note may belong to a nearby
body line, be a separate note, or be text omitted from the main transcript.

## Multi-View Image Enhancement

Faint handwriting may become easier for both segmentation and transcription
after careful image enhancement.

The original archival image must remain canonical. Enhancements should be
temporary, reproducible derivative views.

Useful candidate views include:

- original color;
- background-normalized color;
- gentle local-contrast enhancement;
- gamma-adjusted views for faint pencil or ink;
- grayscale;
- individual red, green, and blue channels;
- mild denoising;
- adaptive threshold or binarized views;
- rotated enhanced crops for sideways candidates.

Different views may serve different tasks:

```text
Original image          -> authentic visual evidence and human review
Enhanced color/grayscale -> faint-stroke recognition
Binarized view          -> possible segmentation input
Original + enhancement  -> contextual LLM comparison
```

### Enhancement risks

Aggressive processing can:

- convert paper fibers into false strokes;
- strengthen bleed-through from the reverse side;
- erase faint pencil;
- join separate characters;
- create false line detections;
- make an LLM confidently interpret processing artifacts.

Therefore:

- never overwrite or hide the original;
- use only a small controlled set of recipes;
- require review when text appears only in an aggressive view;
- measure false detections as well as recovered text.

If physical letters can be recaptured later, diffuse lighting, exposure
bracketing, polarization, and carefully controlled raking light may recover
information that digital processing cannot.

## Consensus Instead of One Source of Truth

The long-term system should use complementary evidence:

| Evidence source | Primary strength |
|---|---|
| Segmentation model | Text location and line geometry |
| Archive HTR model | Spatially grounded line transcription |
| Full-page vision LLM | Meaning, continuity, and difficult handwriting |
| Contextual crop LLM | High-resolution targeted rereading |
| Human reviewer | Final authority and correction |

Suggested behavior:

- strong agreement -> high-confidence proposed link;
- partial agreement -> show alternatives;
- strong disagreement -> focused review;
- missing segmentation -> retain the page-level transcript as unlocated;
- visible text absent from the transcript -> preserve as separate document text;
- insufficient evidence -> abstain.

## Evaluation Plan

Do not judge improvements from a few attractive screenshots.

### Data splits

Split evaluation by entire letter and preferably by writer. Randomly splitting
lines from the same letter or writer between training and testing can produce
misleadingly optimistic results.

Keep a frozen gold test set that is never used for training or pseudo-labeling.

### Compare transcription strategies

Measure:

1. full page only;
2. isolated line crop only;
3. sliding three-line crop;
4. full-page draft followed by contextual crop rereading;
5. generic HTR versus fine-tuned HTR versus scratch-trained HTR;
6. original images versus each controlled enhancement recipe.

### Metrics

Track:

- character error rate;
- word error rate;
- line-detection precision, recall, and F1;
- transcript-to-segment alignment accuracy;
- missed-line and false-line counts;
- omission and fabrication rates;
- percentage automatically accepted;
- percentage requiring review;
- human correction time per page;
- inference cost and runtime.

The human-review time is a first-class metric. A model with slightly worse raw
OCR but much clearer uncertainty may be better for the archive than one that is
occasionally confident and wrong.

### Important challenge cases

Maintain explicit examples for:

- split physical lines;
- missing detections;
- neighboring-page text;
- printed stationery absent from the transcript;
- page numbers;
- faint pencil or ink;
- bleed-through;
- interlinear corrections;
- marginal and sideways text;
- LLM line-order mistakes;
- poor or completely incorrect source transcripts.

Existing difficult examples from collections 003, 007, 008, 009, 011, and 014
are useful starting points.

## Recommended Future Implementation Order

1. Finish stabilizing current physical-row reconstruction and alignment.
2. Persist high-quality alignment decisions and correction provenance.
3. Add an explicit "approved for training" data path.
4. Build the contextual crop experiment on a small frozen challenge set.
5. Run controlled image-enhancement ablations.
6. Fine-tune a recognition model on confirmed line pairs.
7. Integrate the better recognizer as another alignment evidence source.
8. Add active learning so the system prioritizes examples that teach the model
   the most.
9. Accumulate corrected page-level baselines, polygons, orientations, and
   layout classes.
10. Fine-tune or train an archive-specific segmentation model.
11. Compare fine-tuned and scratch-trained recognition models.
12. Consider a custom Kraken 7 model plugin or new architecture only if the
    measured limitations justify it.

## Resume and Portfolio Value

The strongest project story is broader than simply training a model from
scratch:

> Built a domain-specific historical handwriting recognition system and
> human-verified ground-truth dataset; compared transfer learning with
> scratch training using writer-held-out evaluation; integrated OCR,
> vision-LLM consensus, active learning, and human verification into a
> production archive.

That demonstrates dataset design, model training, experimentation, evaluation,
deployment, safety, and product design.

## Guardrails

- Preserve the original image and transcript versions.
- Never treat an unconfirmed LLM output as gold training data.
- Never let better OCR hide uncertainty from the reviewer.
- Do not conflate recognition quality with segmentation quality.
- Keep model and prompt provenance for every generated result.
- Version datasets, training configurations, models, and evaluation reports.
- Prefer abstention over a confident but unsupported connection.
- Require measured improvement on the frozen test set before deployment.

## Open Questions for Later

- Should the primary model cover all writers, or should recurring writers also
  receive specialist models?
- Which pretrained recognition model is the best fine-tuning base?
- How much confirmed data is needed before scratch training becomes competitive?
- Which enhancement recipes help each ink, paper, and capture condition?
- Should contextual crop calls run automatically or only when requested?
- How should the UI distinguish untranscribed document text from missed letter
  content?
- Which confirmed review actions should enter training automatically, and which
  require explicit approval?

## References

- [Kraken recognition-model training](https://kraken.re/main/user_guide/training_recognition.html)
- [Kraken segmentation-model training](https://kraken.re/main/user_guide/training_segmentation.html)
- [Kraken 7 task API and forced alignment](https://kraken.re/7.0/user_guide/api.html)
- [Kraken model management](https://kraken.re/7.0/user_guide/models.html)
