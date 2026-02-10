# Plan: Resizable Split Panel

**Status:** IMPLEMENTING
**Created:** 2026-02-10
**Description:** Add draggable divider between image viewer and transcript panels with smart auto-scroll, line highlighting, and verified transcript editing flow

---

## Goal

Add a resizable split panel feature with:
1. Draggable divider between image viewer and transcript/metadata panels
2. Smart auto-scroll when changing letter pages (smooth, not jarring)
3. Line highlighting in transcript editor for better orientation
4. Verified transcript editing flow (double-click to edit/unverify)
5. Split ratio persistence per letter (like zoom state)

---

## User Decisions (Confirmed)

| Feature | Decision |
|---------|----------|
| Line highlighting | **Yes**, logical line only (not wrapped), text-width background |
| Line highlight update | **On cursor move only** (not every keystroke) |
| Divider visibility | **Always visible** (not hover-only) |
| Snap points | **No**, fully fluid movement |
| Page-to-image sync | **Yes**, with smart auto-scroll logic |
| Auto-scroll behavior | **Smooth transition** (not jarring jump) |
| Auto-scroll offset | **No offset** - header flush at top is fine |
| Split persistence | **Yes**, per letter (same localStorage key as zoom) |
| Min widths | Image 40%, Details 30% |
| Mobile tap to cycle | **No**, drag only |
| Double-click reset | **No** (persistence replaces reset) |
| Keyboard shortcuts | **No** |
| Tooltip on hover | **No** |
| Zoom on resize | **Keep current zoom** |
| Single-page letters | **Hide "Page 1" header** if only one letter page (even with other content types) |
| Verified transcript edit | **Double-click** to edit (single-click shows tooltip) |
| Edit tooltip | "Verified. Double-click to edit and unverify." (near click, 3s or until double-click) |
| Unverify notification | "Verification removed" |
| Visual state difference | **Yes**, subtle difference between verified/editable |
| Revert functionality | **Yes**, revert to session start (when editing began) |
| Revert confirmation | **Yes**, "Discard all changes since editing started?" |
| Post-revert state | Restore original verification status |

---

## Requirements

### 1. Resizable Split Panel

**Desktop (width > 768px):**
- Vertical draggable divider between panels
- Always visible handle (4px wide, 40px tall, centered vertically)
- Fully fluid drag (no snap points)
- Min widths: Image 40%, Details 30%

**Mobile (width ≤ 768px):**
- Horizontal draggable divider
- Image panel sticky at top
- Divider controls vertical height split
- Min heights: 30% each

### 2. Split Ratio Persistence

- Store split ratio in same localStorage key as zoom (`letterViewerState`)
- Scoped to one letter at a time (same as zoom behavior)
- When switching letters, old data clears, new letter starts at default 60/40
- When returning to same letter, restore saved split ratio

### 3. Smart Auto-Scroll on Page Change

When user navigates to a different letter page image:

**Logic:**
1. If the new image is NOT a letter page (envelope, card, etc.) → **do nothing**
2. Check if transcript editor is currently visible in viewport (>10% visible)
3. If transcript IS visible → **smooth scroll** to the corresponding page section
4. If transcript is NOT visible (user scrolled to metadata) → **do nothing**

**Key: Smooth scrolling, not jarring snaps**
```typescript
pageHeader?.scrollIntoView({
  behavior: 'smooth',  // NOT 'instant' or 'auto'
  block: 'start'
});
```

### 4. Single-Page Letter Header

- Hide "Page 1" header if letter has only ONE letter-type page
- Even if there are envelope/card images, still hide if only 1 letter page
- Show page headers when there are 2+ letter pages

### 5. Line Highlighting in Transcript Editor

- Subtle background highlight on the logical line containing cursor (up to newline)
- Text-width only (not full container width)
- Only active when editing (not when verified/locked)
- Updates on cursor move, not on every keystroke
- Light color that doesn't interfere with readability

### 6. Verified Transcript Editing Flow

**When transcript is verified:**
- Transcript area has subtle visual difference (e.g., slightly different background/border)
- Single-click on transcript shows tooltip: "Verified. Double-click to edit and unverify."
- Tooltip appears near click position, auto-dismisses after 3 seconds OR when user double-clicks
- Double-click:
  1. Dismisses tooltip
  2. Calls API to unverify transcript
  3. Shows notification: "Verification removed"
  4. Enables editing mode
  5. Stores original text + original verification state for potential revert

**When transcript is unverified/editing:**
- Transcript is editable (current behavior)
- "Mark Transcript Done" button appears (existing behavior)
- Changes auto-save as they're made (existing behavior)
- Revert button visible (appears after first change)

**Revert functionality:**
- Button only visible after changes have been made
- On click, shows confirmation: "Discard all changes since editing started?"
- If confirmed:
  - Restores original text (from when double-click happened)
  - Restores original verification status
  - If was verified, calls API to re-verify
  - Shows notification confirming revert

---

## Approach

**Create a reusable `ResizableSplitPane` component** in `frontend/src/components/common/`.

Rationale:
- Both pages share identical two-panel layout structure
- Follows existing pattern (components in common/ barrel)
- Avoids duplicating drag logic in two places

---

## Component Interface

```typescript
interface ResizableSplitPaneProps {
  children: [React.ReactNode, React.ReactNode];
  defaultSplit?: number;        // 0-1, default 0.6
  minFirstPanel?: number;       // default 0.4
  minSecondPanel?: number;      // default 0.3
  gap?: string;                 // default 'var(--spacing-lg)'
  className?: string;
  firstPanelClassName?: string;
  secondPanelClassName?: string;
  letterId?: string;            // NEW: for localStorage persistence
  onSplitChange?: (ratio: number) => void;
}
```

---

## Files to Create

### `frontend/src/components/common/ResizableSplitPane.tsx`

**State:**
- `splitRatio` (number, 0-1)
- `isDragging` (boolean)
- `direction` ('horizontal' | 'vertical')

**Features:**
- Mouse/touch drag handlers
- Document-level listeners during drag
- Window resize detection for direction switch
- Prevent text selection during drag
- localStorage persistence (same key as LetterViewer zoom)

**Persistence Logic:**
```typescript
const STORAGE_KEY = 'letterViewerState';

// On mount: load split ratio if same letter, else use default
// On split change: save to localStorage (debounced)
// Storage structure addition:
interface StoredState {
  letterId: string;
  images: Record<string, ImageViewState>;
  splitRatio?: number;  // NEW
}
```

### `frontend/src/components/common/ResizableSplitPane.css`

```css
/* Desktop - vertical divider */
.split-pane {
  display: grid;
  grid-template-columns: var(--first-size) var(--second-size);
  gap: var(--split-gap, var(--spacing-lg));
  height: 100%;
  position: relative;
}

.split-pane-divider {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 32px;
  left: calc(var(--split-percent) - 16px);
  cursor: col-resize;
  z-index: 10;
}

/* Always visible handle */
.split-pane-divider::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 4px;
  height: 40px;
  background: var(--border);
  border-radius: 2px;
  transition: background 0.15s ease;
}

.split-pane-divider:hover::after,
.split-pane-divider.dragging::after {
  background: var(--text-muted);
}

/* Mobile - horizontal divider */
@media (max-width: 768px) {
  .split-pane {
    display: flex;
    flex-direction: column;
    height: calc(100vh - 53px);
  }

  .split-pane-first {
    position: sticky;
    top: 53px;
    flex: 0 0 var(--first-height);
    overflow: hidden;
  }

  .split-pane-second {
    flex: 1;
    overflow-y: auto;
  }

  .split-pane-divider {
    position: relative;
    width: 100%;
    height: 24px;
    cursor: row-resize;
  }

  .split-pane-divider::after {
    width: 40px;
    height: 4px;
  }
}
```

---

## Files to Modify

### `frontend/src/components/common/index.ts`
- Add `ResizableSplitPane` export

### `frontend/src/components/LetterDisplay/LetterDisplay.tsx`
- Wrap layout with `ResizableSplitPane`
- Pass `letterId` for persistence

### `frontend/src/components/LetterDisplay/LetterDisplay.css`
- Remove `.display-layout` grid (lines 55-63)
- Keep panel styles

### `frontend/src/pages/admin/LetterReviewPage.tsx`
- Wrap layout with `ResizableSplitPane`
- Pass `letterId` for persistence
- Add Intersection Observer for transcript visibility tracking
- Add smooth auto-scroll logic on page change
- Pass `onPageChange` to LetterViewer
- Add verified transcript editing flow:
  - Track `isEditing`, `originalText`, `originalVerified` state
  - Handle single-click → show tooltip
  - Handle double-click → unverify + enable editing
  - Add revert button and confirmation logic

### `frontend/src/pages/admin/LetterReviewPage.css`
- Remove `.review-layout` grid (lines 184-192)
- Keep panel styles
- Add line highlighting styles for transcript editor
- Add verified/editable visual distinction styles
- Add tooltip styles for "double-click to edit" message

### `frontend/src/components/LetterViewer/LetterViewer.css`
- Change `height: 83vh` to `height: 100%`
- Change `max-height: 83vh` to `max-height: 100%`

### `frontend/src/components/LetterViewer/LetterViewer.tsx`
- Update localStorage structure to include `splitRatio`

---

## Auto-Scroll Implementation Detail

```typescript
// In LetterReviewPage.tsx

// Track transcript visibility with Intersection Observer
const transcriptRef = useRef<HTMLDivElement>(null);
const [isTranscriptVisible, setIsTranscriptVisible] = useState(true);

useEffect(() => {
  if (!transcriptRef.current) return;

  const observer = new IntersectionObserver(
    ([entry]) => {
      // Consider visible if >10% is showing
      setIsTranscriptVisible(entry.intersectionRatio > 0.1);
    },
    { threshold: [0, 0.1, 0.5, 1] }
  );

  observer.observe(transcriptRef.current);
  return () => observer.disconnect();
}, []);

// Handle page change from LetterViewer
const handlePageChange = (index: number, image: LetterImage) => {
  // Only scroll for letter pages, not envelopes/cards
  if (image.type !== 'letter') return;

  // Only scroll if transcript is visible (user hasn't scrolled to metadata)
  if (!isTranscriptVisible) return;

  // SMOOTH scroll to corresponding page section
  const pageHeader = document.querySelector(`[data-page="${image.pageNumber}"]`);
  pageHeader?.scrollIntoView({
    behavior: 'smooth',  // Key: smooth, not instant
    block: 'start'
  });
};
```

---

## Line Highlighting Implementation

```typescript
// Track cursor position in transcript textarea
const [currentLineIndex, setCurrentLineIndex] = useState<number | null>(null);

const handleSelectionChange = () => {
  const textarea = transcriptRef.current;
  if (!textarea || !isEditing) {
    setCurrentLineIndex(null);
    return;
  }

  const cursorPos = textarea.selectionStart;
  const textBeforeCursor = textarea.value.substring(0, cursorPos);
  const lineIndex = textBeforeCursor.split('\n').length - 1;
  setCurrentLineIndex(lineIndex);
};

// Listen for selection changes
useEffect(() => {
  document.addEventListener('selectionchange', handleSelectionChange);
  return () => document.removeEventListener('selectionchange', handleSelectionChange);
}, [isEditing]);
```

```css
/* Line highlighting - rendered as overlay spans */
.transcript-line-highlight {
  background: rgba(0, 0, 0, 0.03);
  border-radius: 2px;
  display: inline;
}

/* Verified state - subtle visual difference */
.transcript-section.verified {
  border-left: 3px solid var(--success, #4caf50);
}

.transcript-section.editing {
  border-left: 3px solid var(--warning, #ff9800);
}
```

---

## Verified Transcript Tooltip

```typescript
// State for tooltip
const [showEditTooltip, setShowEditTooltip] = useState(false);
const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
const tooltipTimeoutRef = useRef<NodeJS.Timeout>();

const handleTranscriptClick = (e: React.MouseEvent) => {
  if (!letter.transcriptVerified || isEditing) return;

  // Show tooltip near click
  setTooltipPosition({ x: e.clientX, y: e.clientY });
  setShowEditTooltip(true);

  // Auto-dismiss after 3 seconds
  clearTimeout(tooltipTimeoutRef.current);
  tooltipTimeoutRef.current = setTimeout(() => {
    setShowEditTooltip(false);
  }, 3000);
};

const handleTranscriptDoubleClick = async () => {
  if (!letter.transcriptVerified) return;

  // Dismiss tooltip
  setShowEditTooltip(false);
  clearTimeout(tooltipTimeoutRef.current);

  // Store original state for potential revert
  setOriginalText(letter.transcript);
  setOriginalVerified(true);

  // Unverify via API
  await api.unverifyTranscript(letterId);

  // Show notification
  showNotification('Verification removed');

  // Enable editing
  setIsEditing(true);
};
```

```css
/* Tooltip near click */
.edit-tooltip {
  position: fixed;
  background: var(--bg-dark);
  color: var(--text);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-md);
  font-size: var(--font-sm);
  box-shadow: var(--shadow-lg);
  z-index: 1000;
  pointer-events: none;
  animation: fadeIn 0.15s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
```

---

## Edge Cases

| Issue | Mitigation |
|-------|------------|
| Drag outside window | Document-level listeners, release on mouseup anywhere |
| Text selection during drag | `user-select: none` on body |
| Window resize crosses breakpoint | Re-detect direction, keep current ratio if valid |
| Touch scroll vs drag conflict | `touch-action: none` on divider |
| LetterViewer zoom conflicts | Divider z-index above, distinct cursor |
| Auto-scroll interrupts metadata editing | Check transcript visibility first |
| No page number on image | Skip auto-scroll if `pageNumber` undefined |
| Single letter page with other types | Count only letter-type images for page header visibility |
| Jarring scroll | Use `behavior: 'smooth'` always |
| Revert after API save | Store original on edit start, API call to restore |
| Rapid double-click | Debounce double-click handler |
| Tooltip positioning near edge | Clamp tooltip position to viewport |

---

## Implementation Steps

1. Create `ResizableSplitPane.tsx` (desktop horizontal only first)
2. Create `ResizableSplitPane.css`
3. Add barrel export
4. Update localStorage structure in LetterViewer to include `splitRatio`
5. Integrate into `LetterDisplay.tsx`
6. Test desktop resize + persistence
7. Integrate into `LetterReviewPage.tsx`
8. Add mobile vertical mode
9. Update LetterViewer.css heights
10. Add Intersection Observer for transcript visibility
11. Add smooth auto-scroll on page change
12. Add single-page header hiding logic
13. Add line highlighting in transcript editor
14. Add verified/editing visual states
15. Add double-click to edit flow with tooltip
16. Add revert functionality with confirmation
17. Test all breakpoints and edge cases

---

## Verification

1. **Desktop resize**: Drag divider, panels resize smoothly
2. **Constraints**: Can't drag past 40%/30% limits
3. **Divider visible**: Handle always shows, highlights on hover
4. **Split persistence**: Leave letter, return → same split ratio
5. **New letter reset**: Open different letter → default 60/40
6. **Mobile vertical**: Divider controls height split
7. **Mobile sticky**: Image stays at top
8. **Auto-scroll works**: Change to page 2 image → **smoothly** scrolls to Page 2 transcript
9. **Auto-scroll skips metadata**: When on metadata section, no scroll on image change
10. **Auto-scroll skips envelopes**: Changing to envelope image doesn't scroll
11. **Scroll is smooth**: No jarring jumps, uses CSS smooth behavior
12. **Single page hides header**: 1 letter page + envelope → no "Page 1" header
13. **Multi page shows headers**: 2+ letter pages → headers visible
14. **Line highlight works**: Cursor in textarea highlights current line
15. **Verified visual**: Verified transcript has subtle indicator (green left border)
16. **Single-click tooltip**: Click verified transcript → tooltip appears
17. **Tooltip dismisses**: After 3s or on double-click
18. **Double-click unverifies**: Double-click → notification, editing enabled
19. **Revert available**: After making changes, revert button appears
20. **Revert works**: Confirm → original text + verification restored
21. **LetterViewer fills container**: Zoom/pan works correctly
22. **Build passes**: No TypeScript errors

---

## Critical Files

| File | Action |
|------|--------|
| `frontend/src/components/common/ResizableSplitPane.tsx` | CREATE |
| `frontend/src/components/common/ResizableSplitPane.css` | CREATE |
| `frontend/src/components/common/index.ts` | MODIFY (add export) |
| `frontend/src/components/LetterViewer/LetterViewer.tsx` | MODIFY (storage structure) |
| `frontend/src/components/LetterDisplay/LetterDisplay.tsx` | MODIFY |
| `frontend/src/components/LetterDisplay/LetterDisplay.css` | MODIFY |
| `frontend/src/pages/admin/LetterReviewPage.tsx` | MODIFY (major changes) |
| `frontend/src/pages/admin/LetterReviewPage.css` | MODIFY |
| `frontend/src/components/LetterViewer/LetterViewer.css` | MODIFY |
