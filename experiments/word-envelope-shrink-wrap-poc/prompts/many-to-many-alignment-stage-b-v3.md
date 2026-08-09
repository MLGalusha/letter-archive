# Many-to-many graph alignment — Stage B v3

<role>
You are executing turn B for the same software-controlled line. Return one JSON
decision and no prose. Software owns the current line, stage, revision, legal
actions, stable visible-span IDs, insertion IDs, word-unit IDs, and transition.
</role>

<new_evidence>
Stage B reveals two rejectable inputs that were physically absent from Stage A:

- line-level transcript nodes, tokenized independently from detector regions; and
- detector proposal nodes, shown as untrusted geometric regions.

The green Stage A spans are stable nodes. Blue detector regions are proposal
nodes—not word claims. Transcript nodes are suggestions—not ground truth. There is
no implicit transcript-to-proposal edge and no one-box/one-word invariant.
</new_evidence>

<task>
Build one typed graph across stable/inserted visible spans, word units, transcript
nodes, and proposal nodes.

1. Re-open every internal boundary, especially wide spans and wide detector
   regions.
2. Split a span into multiple word units when visible boundaries support it.
3. Connect one proposal node to multiple word units when one detector region
   covers multiple words.
4. Connect multiple proposal nodes to one word unit when a word was fragmented.
5. Preserve punctuation as a word unit of kind `punctuation`; an absent transcript
   relation becomes an explicit gap, not a deletion.
6. Use the preallocated insertion span IDs for visible ink missed in Stage A.
7. Keep visibly omitted words even when both transcript and detector missed them.
8. Leave every missing word/transcript/proposal relationship as an explicit gap.

Many-to-many transcript edges are also legal: a word unit may relate to several
transcript nodes, and a transcript node may relate to several word units.
</task>

<exact_accounting>
Software will reject the graph unless all of these are true:

- every visible span has one or more `span_word_edges`;
- every word unit has exactly one `span_word_edge`;
- every word unit has transcript edges or exactly one transcript gap;
- every word unit has proposal edges or exactly one proposal gap;
- every transcript node has word edges or exactly one word gap;
- every proposal node has word edges or exactly one word gap;
- all IDs come from the packet's stable/preallocated tables;
- word IDs and word order use the exact allocated contiguous prefix;
- no edge, gap, node ID, order entry, or reference is duplicated or orphaned.
</exact_accounting>

<directed_reading>
Use `visible_span_order` and word `order` for upright left-to-right semantics. The
directed source-to-upright transform—not raw source x/y and not the morphology
axis—sets order. For clockwise `-90` degree Collection 014 top-margin lines,
semantic order starts at larger source y and proceeds toward smaller source y.
</directed_reading>

<gap_examples>
- A visible `Love` omitted from transcript and detector has one word unit plus two
  gaps: word→transcript (`omitted_visible_word`) and word→proposal
  (`detector_miss`).
- Visible punctuation absent from transcript has a word→transcript gap with
  `punctuation_untranscribed`.
- A transcript node with no visible ink has a transcript→word gap with
  `transcript_without_visible_ink`.
- A false detector region has a proposal→word gap with
  `detector_false_positive`.
</gap_examples>

<decision_rules>
- Copy every binding field and use only a current `legal_actions` value.
- Do not change a stable Stage A span ID. New span IDs must be the exact allocated
  prefix in the packet.
- Do not manufacture word IDs. Use the exact allocated prefix in serialized order.
- Keep graph evidence visual. A plausible phrase is not evidence that omitted ink
  exists, and a wide rectangle is not evidence that only one word exists.
- Use `defer_line` when evidence is insufficient for an exact-accounted graph.
</decision_rules>

<output>
Return one object conforming exactly to
`schemas/alignment-stage-b-decision-v3.schema.json`, with no markdown fence or
extra commentary.
</output>
