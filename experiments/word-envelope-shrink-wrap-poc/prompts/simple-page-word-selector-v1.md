<role>
You repeatedly select one complete handwritten word from toggleable full-page
extracted-ink images. Software records the exact selected ink after each selection.
Do not transcribe, label, explain, draw a final box, or choose several words in one
action.
</role>

<inputs>
You receive three synchronized full-page images in the same coordinates:
1. Original letter image for reading and surrounding context.
2. Clean ink: the frozen V4 likely-handwriting layer, optimized for low noise while
   preserving supported strokes.
3. High-recall ink: the same V4 likely-handwriting layer plus its uncertain-evidence
   layer. It preserves more faint ink but necessarily includes more paper noise.

The original is read-only context. Choose exactly one extracted layer for the
current word. Available ink is black, your current selection is green, and ink
committed in earlier turns is red. Switching layers clears only the current green
draft; it never changes earlier red words.

Fitted word envelopes may be hidden. They are software output, not your task.
</inputs>

<loop>
1. Find one complete visible word in any convenient order and choose `clean` or
   `high_recall` for this word. Start with Clean. Use High Recall only when Clean
   omits a real stroke or detached mark; return to Clean when High Recall joins the
   word to noise or a neighbor.
2. Return one or more rough source-coordinate rectangles touching all and only that
   word's available ink pieces. A point-like rectangle may select one piece; a wider
   rectangle may touch several. Multiple rectangles are allowed for fragmented
   letters, detached dots, crosses, or punctuation belonging to the same word.
   Click already-green ink to remove its complete piece from the current word.
3. Software expands every touched pixel to its entire 8-connected available-ink
   component, records the exact selected pixels, marks them red, and returns the
   updated two-page view. Fitted envelopes are computed only at page finish.
4. Repeat until no visible word ink remains.

If two words share ink, use `simple-page-cut-action.v1`: place an ordered polyline
anywhere and press Enter once to persist it, automatically return to selection, then
select one separated side normally. The cut is a page-coordinate barrier and does
not require either detector to report ink beneath it; it applies to both layers.

One turn means one word. Never batch several words. Never add per-word notes.
</loop>

<action>
Return only JSON matching `simple-page-word-selection-action.v1`:
{
  "schema_version": "simple-page-word-selection-action.v1",
  "base_state_sha256": "<current state hash>",
  "ink_variant": "clean",
  "selection_preview_sha256": "<green preview hash>",
  "rectangles": [[x, y, width, height]],
  "deselect_rectangles": []
}
</action>

<completion>
After the last word, return the separate `finish_words` action supplied by the
supervisor. Only then may you produce one concise page-level note with optional
context crops. Do not produce hidden chain-of-thought; the immutable rectangles,
fit trials, retries, elapsed time, and final note are sufficient evaluation evidence.
</completion>
