# Brainstorming Workspace

This file is used for active brainstorming sessions with Claude. Ideas here are works-in-progress and will evolve during discussion.

---

## How to Use This File

### Starting a Brainstorm
Tell Claude: "Let's brainstorm about [topic]" and the session begins here.

### During Brainstorming
- **Defer judgment** - No idea is bad at first, we explore everything
- **Build on ideas** - Use "Yes, and..." thinking
- **Go for quantity** - More ideas = better options to refine later
- **Stay visual** - Organize with headers, bullets, and sections

### Ending a Brainstorm
When we've explored enough, we'll:
1. Review and consolidate the best ideas
2. Move actionable items to a plan file
3. Clear this file for the next session (or archive if needed)

---

## Current Session: Workflow Refactoring for Letter Archive

**Started:** 2026-02-09
**Topic:** Rethinking how workflow states, editing, and verification work for archivists

---

## The Problem

The current workflow feels wrong:
- Saving a letter auto-transitions to "METADATA_DRAFTED" even if you're mid-edit
- No way to indicate "I'm still working on this" vs "I'm done"
- Workflow states are confusing (what does "Metadata Ready" even mean to an archivist?)
- The connection between AI transcription → human review → verification is unclear

---

## Research Insights

### From Archival Best Practices
- [Smithsonian Archives](https://siarchives.si.edu/what-we-do/digital-curation/digitizing-collections): Digitization involves proper organization before capture
- [Sustainable Heritage Network](https://sustainableheritagenetwork.org/digital-heritage/archival-best-practices-and-workflows-overview): Emphasizes metadata standards and quality control
- [Archives of American Art](https://www.aaa.si.edu/documentation/processing-guidelines-chapter-1-processing-workflow-at-the-archives-of-american-art): After completing a finding aid, notify supervisor for review and approval

### From Document Approval Workflows
- [IDEO](https://www.ideou.com/blogs/inspiration/7-simple-rules-of-brainstorming): Standard pattern: **Draft → Review → Approval → Final**
- [Cflow](https://www.cflowapps.com/document-approval-workflow/): Workflow states should be meaningful and actionable

### From Human-in-the-Loop AI
- [Parseur](https://parseur.com/blog/hitl-best-practices): HITL workflows boost accuracy from ~80% to 95%+
- [Unstract](https://unstract.com/blog/human-in-the-loop-hitl-for-ai-document-processing/): AI generates drafts, humans review and correct
- [Tomedes](https://www.tomedes.com/translator-hub/human-in-the-loop-in-ai-transcript): AI transcription still needs human verification for accuracy

---

## Ideas to Explore

### 1. Separate "Work State" from "Publication State"

**Current problem:** Workflow tries to track both "where is this in the pipeline?" AND "is this ready to publish?"

**Idea:** Split into two independent concepts:
- **Edit State**: `DRAFT` | `IN_REVIEW` | `APPROVED`
- **Visibility**: `HIDDEN` | `PUBLISHED` (already have this)

This way:
- You can save a DRAFT without it auto-transitioning
- A letter stays in DRAFT until you explicitly say "I'm done, review this"
- Publishing is a separate action from completing edits

### 2. Explicit "Mark as Complete" Actions

Instead of auto-transitions based on content:

- **Transcript**: AI generates → Human edits → Human clicks "Transcript Complete" ✓
- **Metadata**: AI extracts → Human edits → Human clicks "Metadata Complete" ✓
- **Review**: Admin reviews → Clicks "Approved" ✓

Each step is explicit, not inferred from "did they type something?"

### 3. Progress Indicators vs Status Labels

**Current:** Single workflow state badge (e.g., "METADATA_DRAFTED")

**Alternative:** Checklist-style progress:
- [ ] Transcription
- [✓] Transcript verified
- [~] Metadata (in progress)
- [ ] Reviewed
- [ ] Published

Visual difference between "not started", "in progress", "complete"

### 4. "Needs Attention" Flag

Sometimes you're mid-edit and need to:
- Walk away
- Ask someone a question
- Research something

**Idea:** A "Needs Attention" or "On Hold" flag that:
- Prevents the letter from appearing "done"
- Can have an optional note ("Waiting on date verification")
- Shows up prominently in the dashboard

### 5. Simpler Workflow States

**Current states:**
- UPLOADED
- TRANSCRIBING (processing)
- TRANSCRIBED
- METADATA_EXTRACTING (processing)
- METADATA_DRAFTED
- REVIEWED

**Proposed simplification:**
- `NEW` - Just uploaded, nothing done
- `PROCESSING` - AI is working on it (transcription or metadata)
- `EDITING` - Human is working on it
- `COMPLETE` - All fields filled, human signed off
- `APPROVED` - Supervisor/second pair of eyes approved

Or even simpler - just track what's DONE:
- Transcript: `PENDING` | `AI_DRAFT` | `VERIFIED`
- Metadata: `PENDING` | `AI_DRAFT` | `VERIFIED`
- Overall: `HIDDEN` | `PUBLISHED`

### 6. Dashboard Column Ideas

What would help an archivist at a glance?

**Current columns:** Sender, Recipient, Date, Collection, Letters, Extras, Workflow, Visibility, Created

**Potential additions:**
- **Last Edited** - When was this last touched?
- **Edited By** - Who last worked on it? (future multi-user)
- **Progress** - Visual indicator (checkmarks, progress bar)
- **Flags** - Notes, needs attention, has issues
- **Time in State** - How long has it been sitting here?

### 7. Review Queue Concept

Instead of one big list, have focused views:

- **My In-Progress** - Letters I'm currently working on
- **Ready for Review** - Completed by others, need approval
- **AI Processed, Needs Verification** - Fresh from AI, never touched
- **Published** - Archive of completed work
- **Flagged/On Hold** - Items needing special attention

### 8. Explicit Save vs Auto-Save

**Current:** You click Save, things auto-transition

**Options:**
- **Auto-save drafts** - Content saves automatically, never transitions
- **Submit for review** - Explicit action to say "I'm done"
- **Quick save** - Just save my work, don't change anything else

### 9. Crowdsource-Ready Architecture (Future)

Even if not implementing now, design so we could later have:
- **Transcriber role** - Can only edit transcripts
- **Reviewer role** - Can approve transcriber work
- **Admin role** - Full access

This means:
- Clear separation of transcript vs metadata editing
- Audit trail of who did what
- Approval workflow between roles

### 10. "Confidence" Indicators

For AI-generated content:
- Show confidence level of AI transcription
- Highlight uncertain words/sections
- Track which parts were human-edited vs AI-original

---

## User Context (Answered)

**Typical workflow:** Batch mode
- Upload many letters at once
- Run AI processing on all of them
- Then go through and review one by one

**Pain points:** All of these:
- ❌ Auto-transitions when saving (even if not done)
- ❌ Confusing state names (what does "METADATA_DRAFTED" mean?)
- ❌ Hard to tell what's done vs in-progress vs needs attention

---

## Refined Ideas (Based on Batch Workflow)

### The Batch Workflow Reality

```
Day 1: Upload 50 letters from a collection
       ↓
       Run "Process All" for transcription
       ↓
       AI transcribes all 50 (takes time)

Day 2: Start reviewing transcripts
       ↓
       Get through 20 letters, have to stop
       ↓
       Next day, where was I? Which 20 did I do?

Day 3: Continue reviewing
       ↓
       Finish transcripts, run metadata extraction
       ↓
       Review metadata, publish when ready
```

### Key Insight: Need to Track "Touched by Human" vs "AI Only"

The batch workflow creates a specific need:
- AI processes many items
- Human needs to know: "Which have I reviewed? Which are AI-only?"
- Current system: All look the same after AI runs

### Proposed: Simple Two-Track System

**Track 1: Content Status** (what exists?)
| Status | Meaning |
|--------|---------|
| `EMPTY` | Just uploaded, no content |
| `AI_DRAFT` | AI generated content, never human-touched |
| `HUMAN_EDITED` | Human has modified the content |
| `VERIFIED` | Human explicitly marked as "I'm done with this" |

**Track 2: Visibility** (who can see it?)
| Status | Meaning |
|--------|---------|
| `HIDDEN` | Only admins can see |
| `PUBLISHED` | Public can see |

**How it works:**
1. Upload letter → `EMPTY` + `HIDDEN`
2. AI transcribes → `AI_DRAFT` + `HIDDEN`
3. Human edits → `HUMAN_EDITED` + `HIDDEN` (auto on any edit)
4. Human clicks "Mark Complete" → `VERIFIED` + `HIDDEN`
5. Human clicks "Publish" → `VERIFIED` + `PUBLISHED`

**Key difference from current:**
- Editing does NOT auto-complete
- There's a clear "I haven't touched this yet" state
- "Mark Complete" is explicit, not inferred

### Dashboard View for Batch Review

When reviewing a batch, the archivist needs to see at a glance:

```
┌─────────────────────────────────────────────────────────────────┐
│ Collection 003: Smith Family Letters                            │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
│                                                                 │
│ Progress: [████████████░░░░░░░░] 24/50 verified                │
│                                                                 │
│ ┌─────────┬─────────┬──────────┬──────────┬─────────┐          │
│ │ Filter: │ AI Only │ Edited   │ Verified │ All     │          │
│ │         │ (26)    │ (12)     │ (12)     │ (50)    │          │
│ └─────────┴─────────┴──────────┴──────────┴─────────┘          │
│                                                                 │
│ Sender          │ Date       │ Status      │ Last Edit        │
│ ─────────────────────────────────────────────────────────────── │
│ John Smith      │ 1886-03-14 │ 🤖 AI Only  │ -                │
│ John Smith      │ 1886-07-11 │ ✏️ Edited   │ 2 hours ago      │
│ Mary Smith      │ 1887-01-01 │ ✓ Verified  │ Yesterday        │
│ ...                                                            │
└─────────────────────────────────────────────────────────────────┘
```

**Key features:**
- Progress bar shows overall completion
- Quick filter by status
- Clear visual distinction: 🤖 AI Only | ✏️ Edited | ✓ Verified
- "Last Edit" column to track recent work

### Simpler Terminology

Instead of technical terms, use plain language:

| Old Term | New Term | Meaning |
|----------|----------|---------|
| UPLOADED | New | Just uploaded |
| TRANSCRIBING | Processing | AI is working |
| TRANSCRIBED | AI Ready | AI done, human hasn't touched |
| METADATA_DRAFTED | AI Ready | (same - merge these) |
| REVIEWED | Verified | Human signed off |
| PUBLISHED | Published | Visible to public |

Or even simpler icons in the UI:
- 🆕 New
- ⚙️ Processing
- 🤖 AI Done (needs review)
- ✏️ In Progress (human editing)
- ✓ Complete
- 🌐 Published

### The "Continue Where I Left Off" Problem

After batch processing, you review some letters and stop. Next session:
- Which did I already review?
- Which still need attention?

**Solution: "My Progress" indicators**

Option A: **Last Viewed timestamp**
- Track when each letter was last opened
- Sort by "not yet viewed" first

Option B: **Explicit "Mark as Reviewed" on each**
- You have to click something to say "I looked at this"
- Unreviewed items are obvious

Option C: **Auto-track based on edits**
- If you edited it, you've seen it
- AI-only items are unreviewed by definition

**Recommendation: Option C is simplest**
- `AI_DRAFT` = you haven't reviewed it yet
- `HUMAN_EDITED` = you've looked at it and made changes
- `VERIFIED` = you've explicitly signed off

### Edge Cases

**"I looked at it but it's perfect, no edits needed"**
- Need a way to mark as reviewed without editing
- Button: "Looks Good ✓" that moves AI_DRAFT → VERIFIED

**"I started editing but need to come back later"**
- It's `HUMAN_EDITED` which clearly shows "in progress"
- No action needed - the state already communicates this

**"I made a mistake, need to re-review"**
- Button to move VERIFIED → HUMAN_EDITED (or back to AI_DRAFT?)
- Or just edit it - any edit on VERIFIED keeps it VERIFIED but updates timestamp

**"AI transcription is terrible, need to redo"**
- "Re-process" button to send back to AI
- Goes back to AI_DRAFT when done

---

## More User Input

**Two-track system:** ✅ Yes, this clicks - separating edit status from visibility makes sense

**Granularity:** Separate tracking for transcript AND metadata
- Want to know: Is the TRANSCRIPT done? Is the METADATA done? Independently.

**Mid-edit:** Both auto-save AND notes, PLUS...

**Version History idea:** 💡
- Save/store changes over time (like GitHub)
- If you make a mistake, go back to a previous version
- See what changed and when
- Could store last day's versions, or last N saves

---

## Refined Model: Separate Status Per Field

### The Full Picture

```
Letter
├── Visibility: HIDDEN | PUBLISHED
├── Transcript
│   ├── Status: EMPTY | AI_DRAFT | EDITED | VERIFIED
│   ├── Content: "Dear Mary..."
│   └── History: [{version: 1, content: "...", timestamp: ..., source: "AI"}, ...]
├── Metadata
│   ├── Status: EMPTY | AI_DRAFT | EDITED | VERIFIED
│   ├── Fields: {sender, recipient, date, location, hook, summary}
│   └── History: [{version: 1, fields: {...}, timestamp: ..., source: "AI"}, ...]
└── Notes: "Check date with Mary - illegible section"
```

### Status Flow Per Section

```
TRANSCRIPT:
  Upload → EMPTY
  AI runs → AI_DRAFT (v1 created, source: AI)
  Human edits → EDITED (v2 created, source: human)
  Human clicks "Done" → VERIFIED
  Human edits again → EDITED (v3 created, source: human)
  Human clicks "Done" → VERIFIED

METADATA:
  Same flow, independent of transcript
```

### Version History Design

**What to store:**
- Full content snapshot at each save
- Timestamp
- Source (AI vs human)
- Optional: diff from previous

**How long to keep:**
- Option A: Last 24 hours of changes
- Option B: Last N versions (e.g., 10)
- Option C: Forever (storage consideration)
- Option D: Configurable per collection

**UI for history:**
```
┌─────────────────────────────────────────┐
│ Transcript History                      │
│ ─────────────────────────────────────── │
│ ● Current (2 min ago) - You            │
│ ○ v3 (1 hour ago) - You                │
│ ○ v2 (Yesterday) - You                 │
│ ○ v1 (2 days ago) - AI Generated       │
│                                         │
│ [View Diff] [Restore v3]               │
└─────────────────────────────────────────┘
```

### Dashboard with Dual Progress

Show both transcript AND metadata status:

```
│ Sender      │ Date       │ Transcript │ Metadata  │ Notes │
│ ────────────────────────────────────────────────────────── │
│ John Smith  │ 1886-03-14 │ 🤖 AI      │ 🤖 AI     │       │
│ John Smith  │ 1886-07-11 │ ✏️ Edited  │ 🤖 AI     │       │
│ Mary Smith  │ 1887-01-01 │ ✓ Done     │ ✏️ Edited │ 📝    │
│ Jane Doe    │ 1888-05-20 │ ✓ Done     │ ✓ Done    │       │
```

Or compact version with icons:
```
│ Status          │
│ T: ✓  M: ✏️  📝 │  (Transcript done, Metadata editing, has note)
│ T: 🤖 M: 🤖     │  (Both AI only)
│ T: ✓  M: ✓      │  (Both done)
```

### The Notes Feature

**Purpose:** Leave yourself reminders when walking away mid-edit

**Implementation:**
- Simple text field on the letter
- Shows indicator (📝) in dashboard
- Can filter by "has notes"
- Optional: Categorize notes (Question, To-Do, Issue)

**Example notes:**
- "Check date with Mary"
- "Illegible section on page 2 - need better scan"
- "Sender name unclear - Smith or Smyth?"
- "Waiting for response from historical society"

---

## Emerging Design Summary

### Database Changes Needed

1. **Add to letters table:**
   - `transcript_status`: enum (EMPTY, AI_DRAFT, EDITED, VERIFIED)
   - `metadata_status`: enum (EMPTY, AI_DRAFT, EDITED, VERIFIED)
   - `notes`: text (nullable)
   - `transcript_verified_at`: timestamp
   - `metadata_verified_at`: timestamp

2. **New version history table:**
   ```sql
   letter_versions (
     id,
     letter_id,
     field_type: 'transcript' | 'metadata',
     version_number,
     content: jsonb,
     source: 'ai' | 'human',
     created_at,
     created_by
   )
   ```

3. **Remove/deprecate:**
   - `workflow` enum (replace with transcript_status + metadata_status)
   - Or keep for backward compatibility during migration

### UI Changes Needed

1. **Dashboard:**
   - Replace single "Workflow" column with "Transcript" + "Metadata" columns
   - Add "Notes" indicator column
   - Add filters for each status independently

2. **Review Page:**
   - "Mark Transcript Done" button (separate from save)
   - "Mark Metadata Done" button (separate from save)
   - Notes field (always visible)
   - Version history panel (expandable)

3. **Auto-save:**
   - Save on blur or after typing pause
   - Creates new version in history
   - Does NOT change status (that's explicit)

---

## Final Design Decisions

### Version History: Last 24-48 hours
- Covers "oops I made a mistake today" use case
- Keeps storage reasonable
- Could add a "star" feature later to keep important versions forever

### Dashboard: Two Separate Columns
- "Transcript" column with status icon
- "Metadata" column with status icon
- Clearer than combined, more filterable

### Auto-save: True Auto-save (Google Docs style)
- Saves as you type (debounced)
- UI indicator showing save status:
  - "Saving..." (spinner)
  - "Saved ✓" (fade out after a moment)
  - "Save failed" (red, retry option)

---

## Filtering Redesign

### Current Filter System
The current system has workflow filters like:
- "Uploaded" | "Transcribed" | "Metadata Ready" | "Reviewed"

### New Filter System (Two-Axis)

**Transcript Status Filter:**
```
[All] [Empty] [AI Draft] [Edited] [Verified]
```

**Metadata Status Filter:**
```
[All] [Empty] [AI Draft] [Edited] [Verified]
```

**Visibility Filter:** (keep as-is)
```
[All] [Hidden] [Published]
```

### Filter Combinations

This creates powerful combinations:
- "Show me letters where transcript is VERIFIED but metadata is AI_DRAFT"
  → These are ready for metadata review
- "Show me letters where both are AI_DRAFT"
  → These haven't been touched at all
- "Show me letters where anything is EDITED"
  → These are in-progress

### Quick Filter Presets

Instead of making users pick two filters, offer presets:

| Preset | Transcript | Metadata | Meaning |
|--------|------------|----------|---------|
| 🆕 New | Empty | Empty | Just uploaded, nothing done |
| 🤖 Needs Review | AI_Draft | Any | AI finished, human hasn't touched |
| ✏️ In Progress | Edited | Any OR | Human is working on it |
|                | Any | Edited |  |
| ⏸️ Partially Done | Verified | !Verified | Transcript done, metadata not |
| ✓ Complete | Verified | Verified | Ready to publish |
| 🌐 Published | Any | Any | (filter by visibility) |

### Dashboard Filter Bar Mockup

```
┌─────────────────────────────────────────────────────────────────┐
│ Quick: [All] [Needs Review] [In Progress] [Complete]           │
│                                                                 │
│ Advanced:                                                       │
│ Transcript: [All ▼]  Metadata: [All ▼]  Visibility: [All ▼]   │
└─────────────────────────────────────────────────────────────────┘
```

Quick filters are presets. Advanced filters let you pick exactly what you want.

### Stats Bar Update

Current stats: "21 Uploaded | 63 Transcribed | 0 Metadata | 0 Reviewed"

New stats should reflect the two-axis model:

**Option A: By Stage**
```
Transcripts: 26 AI Draft | 12 Edited | 12 Verified
Metadata:    38 AI Draft | 8 Edited  | 4 Verified
```

**Option B: By Completion**
```
84 Total | 26 Untouched | 20 In Progress | 12 Complete | 1 Published
```

**Option C: Progress Bar**
```
[████████████░░░░░░░░] 38% complete (32/84 letters verified)
```

---

## Auto-Save UI Design

### Save Status Indicator

Location: Top-right of the edit panel, or near the transcript/metadata sections

```
States:
┌──────────────────┐
│ ○ Saving...      │  (spinner, gray text)
└──────────────────┘

┌──────────────────┐
│ ✓ Saved          │  (green, fades after 2s)
└──────────────────┘

┌──────────────────┐
│ ⚠ Save failed    │  (red, click to retry)
└──────────────────┘

┌──────────────────┐
│ ○ Unsaved changes│  (if offline/disconnected)
└──────────────────┘
```

### Debounce Timing
- Start save timer when user stops typing
- Wait 1-2 seconds of inactivity
- Then trigger save
- Reset timer if user starts typing again

### What Gets Saved (Auto)
- Transcript content
- Metadata fields (sender, recipient, date, etc.)
- Notes

### What Requires Explicit Action
- "Mark Transcript Done" → changes transcript_status to VERIFIED
- "Mark Metadata Done" → changes metadata_status to VERIFIED
- "Publish" / "Hide" → changes visibility

---

## Review Page Layout Update

```
┌─────────────────────────────────────────────────────────────────────┐
│ ← Back    Letter: 003-18860314-L01                    [Saved ✓]    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────────────────────────────┐  │
│  │                 │  │ TRANSCRIPT                    [History] │  │
│  │                 │  │ Status: ✏️ Edited                       │  │
│  │   [Image        │  │ ┌─────────────────────────────────────┐ │  │
│  │    Viewer]      │  │ │ Dear Mary,                          │ │  │
│  │                 │  │ │                                     │ │  │
│  │                 │  │ │ I write to you from...              │ │  │
│  │                 │  │ └─────────────────────────────────────┘ │  │
│  │                 │  │                    [Mark Done ✓]        │  │
│  │                 │  ├─────────────────────────────────────────┤  │
│  │                 │  │ METADATA                      [History] │  │
│  │                 │  │ Status: 🤖 AI Draft                     │  │
│  │                 │  │                                         │  │
│  │                 │  │ Sender: [John Smith        ]            │  │
│  │                 │  │ Recipient: [Mary Smith     ]            │  │
│  │                 │  │ Date: [March 14, 1886      ]            │  │
│  │                 │  │ ...                                     │  │
│  │                 │  │                    [Mark Done ✓]        │  │
│  └─────────────────┘  ├─────────────────────────────────────────┤  │
│                       │ NOTES                                   │  │
│                       │ ┌─────────────────────────────────────┐ │  │
│                       │ │ Check date with historical society  │ │  │
│                       │ └─────────────────────────────────────┘ │  │
│                       ├─────────────────────────────────────────┤  │
│                       │ VISIBILITY                              │  │
│                       │ [Hidden] [Publish]                      │  │
│                       └─────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

Key changes:
- Each section (Transcript, Metadata) shows its own status
- Each section has its own "Mark Done" button
- Each section has access to its History
- Auto-save indicator at top
- Notes always visible
- Visibility at bottom (separate from status)

---

## Final Decisions

- **Stats**: By stage counts (worry about UI later - we can make it clean)
- **History view**: Both timeline AND diff with toggle

---

## Future Feature Idea: Line-by-Line Overlay Verification

**The Problem:**
When verifying transcription accuracy, your eyes dart back and forth between:
- The handwritten text on the image
- The transcribed text in the editor

This is tiring and error-prone.

**The Idea:**
An overlay mode where:
1. The image is the background
2. You click on a line of handwritten text
3. The transcribed text for that line appears BELOW the handwritten line (overlaying the next line of the image)
4. Your eyes stay in one spot - comparing handwritten above, typed below
5. Press Enter → saves that line, moves to next line
6. Continue until done

**Visual Concept:**
```
┌─────────────────────────────────────────────────┐
│                                                 │
│  ~~~~ handwritten line 1 ~~~~                   │  ← Original image
│  ┌─────────────────────────────────────────┐   │
│  │ Dear Mary, I write to you from Boston   │   │  ← Transcribed overlay
│  └─────────────────────────────────────────┘   │
│                                                 │
│  ~~~~ handwritten line 3 ~~~~                   │  ← (line 2 hidden by overlay)
│  ~~~~ handwritten line 4 ~~~~                   │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Technical Analysis

**What would be needed:**

1. **Line Detection in Images**
   - Need to identify where each line of text is in the image
   - Options:
     - Manual: User marks line boundaries
     - Semi-auto: AI suggests, user adjusts
     - Full auto: OCR/ML detects lines
   - Complexity: HIGH for auto, MEDIUM for semi-auto, LOW for manual

2. **Line-to-Transcript Mapping**
   - Need to map which transcript text corresponds to which image line
   - Currently transcript is one blob of text
   - Would need to either:
     - Split transcript by lines during AI processing
     - Let user manually align lines
   - Complexity: MEDIUM

3. **Overlay Rendering**
   - Position text precisely over image regions
   - Handle different image sizes/resolutions
   - Font sizing to match handwritten text width
   - Complexity: MEDIUM

4. **Line-by-Line Editing UI**
   - Navigate between lines
   - Edit individual lines
   - Merge/split lines if alignment is off
   - Complexity: MEDIUM

5. **Data Model Changes**
   - Store transcript as array of lines instead of single text
   - Store line bounding boxes per page
   - Complexity: MEDIUM (migration needed)

### Feasibility Assessment

| Aspect | Difficulty | Notes |
|--------|------------|-------|
| Line detection | HIGH | Unless manual, needs ML/CV |
| UI overlay | MEDIUM | CSS positioning, canvas |
| Data model | MEDIUM | Schema change, migration |
| UX polish | HIGH | Many edge cases |
| **Overall** | **HIGH** | Significant feature |

### Recommendation

**Drop for now, revisit later.** Reasons:

1. **High complexity** - This is a significant feature, not a quick add
2. **Core workflow first** - Let's nail the basic workflow redesign first
3. **Validate need** - After using the new workflow, see if this is still the biggest pain point
4. **Incremental approach** - Could start with a simpler "split view" (image left, transcript right with line highlighting) before full overlay

### If We Did Implement (Simplified V1)

A simpler first version:
1. **Manual line markers** - User clicks to mark where lines start/end on image
2. **Side-by-side with sync scroll** - Image on left, transcript on right, clicking a line in one highlights it in the other
3. **Later: overlay mode** - Once line mapping exists, add the overlay view

This breaks it into smaller pieces.

---

## Parking Lot - Future Ideas

> These ideas are parked for later. Not implementing now but don't want to forget them.

### 1. Line-by-Line Overlay Verification Mode
See detailed analysis above. Revisit after workflow redesign is complete and we've validated the need.

### 2. Version History Beyond 48 Hours
- "Star" important versions to keep forever
- Export version history
- Compare any two versions

### 3. Crowdsourcing Support
- Transcriber role (transcript only)
- Reviewer role (approve transcripts)
- Admin role (full access)
- Assignment/claim system

### 4. AI Confidence Highlighting
- Show which words AI was uncertain about
- Highlight low-confidence sections for review
- Track which parts were human-edited

### 5. Keyboard Shortcuts
- Navigate between letters
- Quick actions (mark done, save, etc.)
- Vim-style editing?

### 6. Batch Editing
- Select multiple letters
- Apply same change to all (e.g., fix recurring OCR error)

### 7. Export/Reporting
- Export collection to various formats
- Progress reports
- Quality metrics

---

## Session Summary

### What We Decided

1. **Two-track system**: Edit status (per section) + Visibility (for publishing)
2. **Separate tracking**: Transcript and Metadata each have their own status
3. **Statuses**: EMPTY → AI_DRAFT → EDITED → VERIFIED
4. **Auto-save**: True auto-save with visual indicator
5. **Version history**: Last 24-48 hours, with diff view option
6. **Notes**: Field for leaving reminders
7. **Dashboard**: Two columns for transcript/metadata status, stage counts
8. **Filters**: Quick presets + advanced two-axis filtering

### What We're NOT Doing Now

1. Line-by-line overlay verification (parked for future)
2. Crowdsourcing roles (parked)
3. AI confidence indicators (parked)

### Next Step

Convert this brainstorm into an implementation plan, then start building!

---

## Questions Still Open

---

## Parking Lot (Ideas to revisit later)

- Version history for transcripts
- Comparison view (AI vs human edits)
- Keyboard shortcuts for common actions
- Batch editing capabilities
- Export/reporting features

---

## Next Steps

Once we've explored these ideas:
1. Pick the approach that feels right
2. Define the new workflow states
3. Map out the UI changes needed
4. Create implementation plan