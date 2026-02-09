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