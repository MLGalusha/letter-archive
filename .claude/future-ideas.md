# Future Ideas

Ideas we've discussed but decided to defer. Revisit when the core features are stable.

---

## 1. Line-by-Line Overlay Verification Mode

**What:** An editing mode where transcribed text overlays directly on the image, line by line, so your eyes don't have to dart between image and editor.

**Why deferred:** High complexity (needs line detection, mapping, precise positioning). Better to nail the basic workflow first.

**Simpler first step:** Side-by-side view with synchronized highlighting - clicking a line in the image highlights the corresponding transcript section.

**Discussed:** 2026-02-09

---

## 2. Crowdsourcing / Multi-Role Support

**What:**
- Transcriber role (edit transcripts only)
- Reviewer role (approve transcriber work)
- Admin role (full access)
- Assignment/claim system for work distribution

**Why deferred:** Current focus is single-user workflow. Architecture should support this later.

**Discussed:** 2026-02-09

---

## 3. AI Confidence Indicators

**What:**
- Show confidence level of AI transcription per word/section
- Highlight uncertain sections for priority review
- Track which parts were human-edited vs AI-original

**Why deferred:** Requires changes to AI processing pipeline. Nice-to-have, not essential.

**Discussed:** 2026-02-09

---

## 4. Extended Version History

**What:**
- Keep versions longer than 48 hours for "starred" important snapshots
- Export version history
- Compare any two versions (not just current vs past)

**Why deferred:** Basic 48-hour history covers immediate needs.

**Discussed:** 2026-02-09

---

## 5. Keyboard Shortcuts

**What:**
- Navigate between letters (j/k or arrows)
- Quick actions (Cmd+S, Cmd+Enter for mark done)
- Vim-style editing in transcript?

**Why deferred:** Polish feature, add after core workflow works.

---

## 6. Batch Editing

**What:**
- Select multiple letters
- Apply same metadata to all
- Fix recurring OCR errors across collection

**Why deferred:** Advanced feature, single-letter editing is priority.

---

## 7. Export & Reporting

**What:**
- Export collection to CSV, JSON, PDF
- Progress reports (how much done per week)
- Quality metrics (edit rate, time to complete)

**Why deferred:** Focus on input workflow before output features.

---

## How to Use This File

When a future idea comes up in conversation:
1. Add it here with context
2. Note why it's deferred
3. Revisit when appropriate

When ready to implement:
1. Move the idea to a plan file
2. Keep a note here that it was implemented

---

## 8. Stories & Collection Narrative System

**What:** A narrative layer built on top of collections that weaves letters into explorable story experiences. This goes beyond the current "collection = organizational bucket" model to make collections tell stories.

**The Vision:**

The archive has two modes of exploration:
1. **Archive Mode** (current) - Factual, searchable, filterable. Browse individual letters.
2. **Stories Mode** (future) - Narrative, guided, explorable. Experience letters as interconnected stories.

**Key Concepts:**

- **Collections** = Archival groupings (what exists now: code, title, description)
- **Stories** = Narrative experiences built from letters in collections
- Relationship between collections and stories is flexible (1:1, 1:many, or many:1 depending on content)

**Types of Relations to Capture:**

1. **Chronological narrative** - Letters form a timeline/story arc (courtship → marriage → family life)
2. **People connections** - Same sender/recipient across letters, family trees, social networks
3. **Topic/theme threads** - Letters about same events, places, or themes (war, illness, business)
4. **Response chains** - Letter A is a reply to Letter B, conversation threads

**AI Integration Ideas:**

1. **Relation-aware metadata extraction** - During metadata extraction, capture fields like:
   - `mentions_person` - People mentioned in the letter
   - `references_letter` - If it's replying to or mentions another letter
   - `location_sequence` - Track location changes over time
   - `themes` - Recurring topics

2. **Collection-level AI analysis** - Send all letters in a collection to AI to:
   - Identify story arcs and themes
   - Detect relationships between letters
   - Suggest narrative orderings
   - Generate collection summaries

3. **Story generation** - AI creates narrative descriptions that tie letters together, which humans then edit/verify

**Admin UI Direction:**

- Main admin page stays letter-focused (current AdminDashboard)
- Add a toggle/tab to switch to "Collection View"
- Collection View shows:
  - List of collections with stats (letter count, completion %, etc.)
  - Click into a collection to see its letters + collection metadata
  - Edit collection title/description
  - Eventually: manage relations, story arcs, narrative content

**Public UI Direction:**

- Keep current archive browsing (search, filter, individual letters)
- Add a separate "Stories" or "Explore" section
- Users can browse by story/collection rather than individual letters
- Stories guide users through letters in a meaningful order with narrative context

**Why Deferred:**

1. Archive is in early stage (<100 letters processed)
2. No verified transcripts yet
3. No extracted metadata yet
4. Stories require content depth to be meaningful
5. Better to nail the processing pipeline and basic public UI first

**Prerequisites Before Building:**

1. Multiple collections with verified, metadata-rich letters
2. Solid public reading experience
3. Working search/filter
4. Consider adding relation-aware metadata fields to extraction pipeline (plant seeds now)

**Simpler First Steps (when ready):**

1. Basic collection CRUD in admin (edit title/description)
2. Collection stats dashboard (letter count, completion %)
3. Add relation fields to metadata extraction
4. Then build toward full Stories experience

**Discussed:** 2026-02-09