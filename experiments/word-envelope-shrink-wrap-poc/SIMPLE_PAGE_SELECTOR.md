# Simple full-page selector experiment

This is the deliberately minimal counterfactual to the proposal-driven ownership
console. It asks whether a person or vision agent needs Kraken/proposed word crops
at all.

There are now three full-page variants:

- `visible_ink_components`: original context plus a visible strong-ink selection page.
- `source_color_guided`: only the original photograph is visible. A conservative
  hidden mask supplies location seeds, while local brightness and color continuity
  determine the selected source pixels.
- `dual_extracted_ink`: the original photograph is read-only context. The reviewer
  selects on one exact extracted-ink page and can switch instantly between **Clean
  ink** (the frozen V4 likely-handwriting layer) and **High recall** (V4 likely plus
  uncertain evidence). Exactly one layer supplies each word and is recorded with
  the claim. Neither layer contains synthetic bridge pixels.

The active 007 trial uses `dual_extracted_ink`. The original-only color-growth
counterfactual was useful evidence, but it was slower and made messy paper/ink
boundaries harder to control than selecting the extracted masks directly.

## Human loop

The UI has two deliberately simple pages. **Library** shows the internal Letter
Archive pages as thumbnails. A card says Start, Resume, or Complete. Opening a
saved card always returns to its active run; switching pages never resets it.
**Workspace** is the selection loop below. **Reset page** is the only UI action
that creates a new zero-word run. The prior run remains on disk rather than being
overwritten.

1. Use the original only for context. Start with Clean ink. Toggle High recall only
   when Clean omits a real stroke or detached mark.
2. Click one ink piece or drag across one complete word on the ink page. Touching
   any pixel selects that entire 8-connected available-ink piece. Click or drag
   again to add another disconnected piece. Click green ink to remove its complete
   selected piece; click the same place again to restore it.
3. Press Enter.
4. The exact selected source ink becomes red on both pages. Repeat.

The browser keeps the last green overlay mounted while software computes an added
or removed piece, so selection never flashes blank. Enter records exact pixels only;
it does not run fitted geometry. **Finish + fit boxes** runs the standard,
fragmented-word, and detached-mark envelope fallbacks for every pending word in one
explicit page-level batch. A valid word is therefore never blocked by geometry.

**Page zoom** scales only the original and extracted-ink canvases inside fixed
page-card viewports. The application toolbar, controls, card frames, and text never
scale. Original and ink viewport scrolling is synchronized so both remain on the
same source location from 100–400%.

**Recover missed ink** expands the temporary selectable-ink universe; it never
automatically selects recovered pixels. Starting recovery clears the green word.
The reviewer must click or drag the desired recovered strokes again, using the same
whole-component behavior as normal ink. Untouched recovered specks stay unselected
and cannot affect the final fitted envelope. Recovery is scoped to that one word:
pressing Enter immediately restores the chosen Clean or High-recall layer before
the next word can be selected.

For touching words, **Cut ink** accepts an ordered 2–32 point path. One Enter
persists it and automatically returns to selection, where either separated side can
be clicked. There is no disposable preview state for the person to accidentally
cancel. A cut is a persistent
page-coordinate barrier, not a detector operation: it is accepted even when both
ink layers report zero pixels beneath it, and neither current nor future layer
pixels can connect across it. **Erase selection** clears the current green work
without changing committed red words.

If Enter commits the wrong word, **Undo last red word** (or Command/Control+Z)
creates a new append-only revision that restores exactly that latest word’s pixels
to selectable ink. Historical mask files remain immutable; recommitting the same
ordinal writes a revision-qualified replacement artifact instead of overwriting the
original.

Backspace removes the latest edit or cut point. Escape clears the current word or
cancels Cut. Fitted envelopes appear only after the end batch and remain hidden
unless **Boxes** is toggled on. Word order is unconstrained. There is no transcript, tentative label, confidence,
difficulty, proposal review, or per-word note.

After **Finish page**, one final notes screen accepts a page summary and optional
source-coordinate context crops. Notes cannot interrupt the word loop.

## Agent contract

The acting model receives only the original context plus Clean extracted ink and
returns one or more rough rectangles for one word. High-recall ink is not a
permanent third panel or a routine per-word choice. When Clean visibly misses a
stroke, the model can request source-supported recovery; that temporarily replaces
the Clean panel for the current word and disappears immediately after Enter.
Software performs the exact intersection, claim, red overlay, and next-state
construction; fitting is page-final. The next experiment should compare:

- free full-page selection;
- software-proposed crop selection;
- later, carefully bounded multiword selection in a single model turn.

Do not start with the multiword variant. It changes both visual memory requirements
and error attribution, so it needs a frozen one-word baseline first.

Prompt: `prompts/simple-page-word-selector-v1.md`

Schema: `schemas/simple-page-word-selection-action-v1.schema.json`

## Current 007 session

`artifacts/simple-page-selector-v1/007-p02-human`

The original proposal-driven console remains separate and unchanged.

## Active dual-layer 007 session

`artifacts/source-color-selector-v1/007-p02-human`

This session began as the original-only counterfactual, then received the append-only
dual-layer capability sidecar so its completed red words and revision history stayed
intact. New words use `prompts/simple-page-word-selector-v1.md` and bind Clean or
High-recall ink explicitly.
