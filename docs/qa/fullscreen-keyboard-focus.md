# Fullscreen scan keyboard and focus ownership

Issue #156, baseline frontend 3b6e4a30 (September 18, 2026).

Opening a scan previously left keyboard focus in the reader. Right Arrow then
navigated to another letter instead of another scan. The viewer now reuses
`useAccessibleDialog`, with opt-in background isolation and named modal semantics.
Left/Right wrap through scans and reset zoom/pan, exactly like the existing page
buttons. They do not change the underlying letter. Escape and the close button
restore the trigger and reading position. Pointer activation explicitly captures
the trigger because Safari does not automatically focus clicked buttons.

The viewer buttons have explicit tabindex=0 so Safari's default button-skipping
preference cannot send focus to browser chrome. The shared hook retains native
Tab order, including radio-group behavior in existing admin dialogs. Existing inert attributes survive
cleanup. Portal placement and existing viewer rendering/gesture behavior remain.

## Research applied

- [WAI modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/):
  named dialog, initial focus, contained Tab sequence, Escape, focus restoration.
- [MDN inert](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inert):
  modal semantics alone do not prevent background focus/activation; isolate the
  portal's sibling branches and restore their prior state.

## Verification

`e2e/tests/viewer-focus.mocked.spec.ts` runs in Chromium and WebKit at phone and
laptop widths: keyboard and pointer open/close, repeated Tab/Shift+Tab, blocked
background focus, scan wrapping, zoom reset, unchanged letter URL, scroll/body
restoration, and leaving the route. Unit tests cover nested portal dismissal,
pre-existing inert state, unmount cleanup, shared modals, and existing swipes.

Browser emulation is not physical iPhone or VoiceOver acceptance. Keep that manual
check on #156 and coordinate accessible zoom/fit controls with viewer design #157.
