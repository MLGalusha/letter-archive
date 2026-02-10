# Plan: Transcription UI Refactor

**Status:** IMPLEMENTING
**Created:** 2026-02-10
**Description:** Simplify transcription section header and move verification to top-right

---

## Context

Currently the transcription section has:
- A grey background container (`editor-section`) with card styling
- Header with "Transcription" title and status badges (Edited/AI Draft, Auto-transcribed)
- A padded `editor-container` with the actual `transcript-editor` inside
- A footer with "Mark Transcript Done" button and line indicator

## Requested Changes

### 1. Remove grey background from header area
- Remove card styling from the outer container
- Keep only the editor box itself styled (`.transcript-editor`)

### 2. Move verification UI to header right side
- **Unverified state**:
  - Left: "Transcription" title + "Edited" status badge (if applicable)
  - Right: Simple checkmark button to verify
- **Verified state**:
  - Left: "Transcription" title (no "Edited" badge since it's verified)
  - Right: "✓ Verified on [date]" with Undo link (same as current `.verified-info`)

### 3. Change verified state border placement
- Remove green left accent border on container
- Add green border color to `.transcript-editor` itself when verified

### 4. Fix line highlighting (NOT line indicator)
- Remove the "Line X" text indicator from footer
- Implement actual line highlighting: highlight the background of the line where the cursor is
- This helps eyes track position when looking between image and transcript

### 5. Move Revert button to page header
- When editing a verified transcript, show "Revert" button in the main page header (next to Save, AI Sync, Delete buttons)
- Remove from section footer

---

## Implementation Plan

### Phase 1: CSS - Remove container styling
**File:** `frontend/src/pages/admin/LetterReviewPage.css`

1. Modify `.editor-section`:
   - Remove `background`, `border`, `border-radius`, `box-shadow`, `border-top`
   - Keep as simple layout container
   - Remove `.editor-section.verified` left border styling
   - Remove `.editor-section.editing` left border styling

2. Modify `.editor-header`:
   - Remove `background: var(--bg)`
   - Remove `border-bottom`
   - Keep flex layout for title + right side controls

3. Modify `.editor-container`:
   - Remove padding and background
   - Just a wrapper

4. Add `.transcript-editor.verified`:
   - `border-color: #4caf50` (green border around editor when verified)

5. Remove `.section-footer` styles for transcript (keep for metadata)

### Phase 2: TSX - Restructure verification UI
**File:** `frontend/src/pages/admin/LetterReviewPage.tsx`

1. In `editor-header`, move verification controls:
   ```tsx
   <div className="editor-header">
     <h2>Transcription</h2>
     <div className="header-right">
       {/* Status badge - only show "Edited" when NOT verified */}
       {letter.transcriptStatus === 'EDITED' && !isTranscriptEditing && (
         renderContentStatus(letter.transcriptStatus)
       )}

       {/* Verification UI */}
       {letter.transcriptStatus === 'VERIFIED' && !isTranscriptEditing ? (
         <div className="verified-info">
           <Icon name="check" size={14} />
           <span>Verified{date}</span>
           <button className="unverify-btn">Undo</button>
         </div>
       ) : (
         <button className="verify-btn" onClick={handleVerifyTranscript}>
           <Icon name="check" size={18} />
         </button>
       )}
     </div>
   </div>
   ```

2. Remove the `section-footer` div for transcript section entirely

3. Move Revert button to page header:
   - Add next to other header-action buttons
   - Only show when `isTranscriptEditing && hasTranscriptChanges`

### Phase 3: Implement line highlighting
**File:** `frontend/src/pages/admin/LetterReviewPage.tsx` and `.css`

1. Keep the `currentLineIndex` state and selection tracking logic
2. Instead of showing "Line X" text, apply a highlight style to the actual line

3. Approach: Use CSS with a dynamic background gradient or overlay
   - Track cursor position and calculate which line
   - Apply highlight via inline style or CSS variable

4. CSS for line highlight:
   ```css
   .transcript-editor {
     /* Use a pseudo-element or gradient for line highlight */
   }
   ```

   Alternative approach: Wrap each line in a span and highlight the active one
   - More complex but more reliable

5. Simpler approach: Use `background` linear-gradient positioned at the current line:
   ```tsx
   style={{
     "--highlight-top": `${currentLineIndex * lineHeight}px`,
   }}
   ```
   ```css
   .transcript-editor::before {
     content: "";
     position: absolute;
     left: 0;
     right: 0;
     top: var(--highlight-top);
     height: 1.6em; /* line-height */
     background: rgba(255, 235, 59, 0.2); /* subtle yellow */
     pointer-events: none;
   }
   ```

### Phase 4: Remove unused code
1. Remove `.line-indicator` styles from CSS
2. Remove line indicator JSX from footer

---

## Files to Modify

1. **`frontend/src/pages/admin/LetterReviewPage.tsx`**
   - Move verification UI from footer to header
   - Move Revert button to page header
   - Remove line indicator text, keep line tracking for highlighting
   - Add line highlight styling

2. **`frontend/src/pages/admin/LetterReviewPage.css`**
   - Remove container card styling
   - Add verified border to editor
   - Add verify button styles
   - Add line highlight styles
   - Remove line-indicator styles
