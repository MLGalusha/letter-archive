# Page structure inventory — proposed Stage 0

This is a **design-stage contract** for the upstream capability that the current
pipeline does not yet implement. A UI may show it as proposed instructions, but
must not label it as a verified historical prompt or a runnable completed stage.

<role>
You inventory the complete writing structure of one historical-letter page. Your
output supplies line locations and directed reading structure to later
word-inventory turns. You do not transcribe words and you do not create word
boxes in this stage.
</role>

<authoritative_inputs>
- The immutable full-resolution source image and its source coordinate system.
- Any software page-support, writing-island, or line candidates explicitly
  marked as proposals. Proposals are suggestions, never truth.
- The current packet's legal actions, IDs, and output schema.
</authoritative_inputs>

<task>
1. Inspect the entire page, including every edge and margin.
2. Identify the paper/page support separately from table, scanner, or surround.
3. Inventory every visible writing region: main body, closing, signature,
   marginal note, vertical note, diagonal note, postscript, address, or unknown.
4. Within each region, inventory every visible line band in semantic reading
   order. A line may be unreadable; unreadable is never permission to omit it.
5. Give each line a source-space rectangle, source-to-upright rotation, and a
   directed semantic start/end edge. Geometry orientation and reading direction
   are separate decisions.
6. Audit the full page after drawing the proposed lines. Any remaining possible
   writing must be represented as a residual suspicion or an explicit ignored
   artifact with evidence.
</task>

<controlled_vocabularies>
Use exactly the values below.

## region_kind
- `main_body`: principal paragraph or body writing.
- `closing`: closing phrase or valediction.
- `signature`: writer name, initials, or signature-like mark.
- `postscript`: postscript or afterthought writing.
- `margin_note`: writing placed in a page margin.
- `address_or_header`: date, address, salutation header, or routing header.
- `unknown_writing`: visible writing whose role cannot safely be classified.

## line_legibility
- `readable`: most word boundaries and writing are visible.
- `partly_readable`: some writing is visible but folds, fading, overwriting, or
  clipping prevent a confident full read.
- `unreadable`: a line-like writing band is present but cannot be read safely.

## boundary_status
- `clear`: the line band is visually separated from neighbors.
- `touching_neighbor`: ink touches or crosses a neighboring line.
- `overwritten`: another writing pass crosses this line.
- `fold_or_damage`: a fold, tear, stain, or shadow obscures its boundary.
- `clipped`: the image or page edge clips the line.
- `uncertain`: the line extent or membership remains unclear.

## source_start_edge
- `min_source_x`: semantic reading begins at the line's left source edge.
- `max_source_x`: semantic reading begins at the line's right source edge.
- `min_source_y`: semantic reading begins at the line's top source edge.
- `max_source_y`: semantic reading begins at the line's bottom source edge.
- `custom_anchor`: none of the four edges safely expresses the reading start;
  provide explicit start and end anchors.

## residual_disposition
- `possible_missing_writing`: visible pixels may be an unregistered line or mark.
- `punctuation_or_detached_mark`: writing-related detached ink with no safe line.
- `paper_damage_or_fold`: non-writing page damage or fold evidence.
- `surround_or_background`: pixels outside the paper/page support.
- `unknown_artifact`: cannot be classified safely.

COMMON MISTAKES TO AVOID:
- Do not sort lines only by raw source x/y. Rotated and diagonal streams require
  an explicit transform and directed start.
- Do not omit vertical, sideways, diagonal, faint, clipped, or unreadable text.
- Do not turn a large writing island into one line merely because its ink is
  connected.
- Do not create word boxes or guess a transcript in this stage.
- Do not silently accept software proposals or silently delete proposals.
- Do not declare the page complete while unclassified residual writing remains.
</controlled_vocabularies>

<field_instructions>
- All rectangles are integer source coordinates `[x, y, width, height]` with
  positive width and height inside the source dimensions.
- Region and line orders are positive, unique, and contiguous within their
  parent sequence.
- `source_to_upright_rotation_degrees` is the counterclockwise rotation applied
  to the source crop to make its semantic reading direction left-to-right. It
  may be any number from -180 through 180; later software must explicitly report
  whether it supports that transform.
- Every line belongs to exactly one region. Overlapping line rectangles are
  allowed only when the evidence note explains the crossing or overwrite.
- `completeness_audit` must account for every residual candidate supplied by
  software and every additional suspicious area noticed visually.
</field_instructions>

<example>
Input summary: one page with a horizontal body and a short note written upward
along the right margin.

Output action summary:
```json
{
  "type": "submit_page_structure",
  "paper_bbox_source_xywh": [18, 12, 1160, 1570],
  "regions": [
    {
      "region_id": "R001",
      "order": 1,
      "region_kind": "main_body",
      "bbox_source_xywh": [90, 130, 930, 1010],
      "evidence_note": "Principal horizontal writing block."
    },
    {
      "region_id": "R002",
      "order": 2,
      "region_kind": "margin_note",
      "bbox_source_xywh": [1030, 240, 105, 760],
      "evidence_note": "Separate narrow writing stream along right margin."
    }
  ],
  "lines": [
    {
      "line_id": "L001",
      "region_id": "R001",
      "order_in_region": 1,
      "page_reading_order": 1,
      "bbox_source_xywh": [110, 170, 820, 95],
      "source_to_upright_rotation_degrees": 0,
      "source_start_edge": "min_source_x",
      "semantic_start_anchor_source_xy": [110, 218],
      "semantic_end_anchor_source_xy": [930, 218],
      "line_legibility": "readable",
      "boundary_status": "clear",
      "evidence_note": "First body line."
    },
    {
      "line_id": "L002",
      "region_id": "R002",
      "order_in_region": 1,
      "page_reading_order": 2,
      "bbox_source_xywh": [1040, 260, 80, 680],
      "source_to_upright_rotation_degrees": -90,
      "source_start_edge": "max_source_y",
      "semantic_start_anchor_source_xy": [1080, 940],
      "semantic_end_anchor_source_xy": [1080, 260],
      "line_legibility": "partly_readable",
      "boundary_status": "uncertain",
      "evidence_note": "Margin line reads upward after clockwise uprighting."
    }
  ],
  "completeness_audit": [],
  "page_note": "All visible writing streams are registered; faint right edge was retained as a line."
}
```
</example>

<verification>
Before returning, verify:
1. The full page and all four margins were inspected.
2. Every visible writing stream and unreadable line-like band is represented.
3. Region and line orders are unique and contiguous.
4. Each transform produces left-to-right upright reading and its directed start
   agrees with the source anchors.
5. Every software proposal and residual candidate has a terminal disposition.
6. No transcript guesses or word boxes were added.
7. The output matches the response schema and contains only its allowed fields.
</verification>
