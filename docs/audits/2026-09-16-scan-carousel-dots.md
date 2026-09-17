# Scan carousel dot synchronization (#11)

Base: `b1f1c5b4` (main). Scope: public letter scan carousel; no padding, fullscreen, image-request, or page-swipe redesign.

## Cause and change

`LetterDetailPage` initially returns its loading screen. Both `useCarouselDrag` effects previously ran only on initial mount, saw a null carousel ref, and never ran again when the scans appeared. This affected both active-dot tracking and desktop mouse drag listeners. Dot JSX also always rendered the first dot active, while the hook independently manipulated dot classes. Finally, comparing a slide's `offsetLeft` to the carousel's `scrollLeft` assumed a shared offset origin.

A stable callback ref now gives the hook its mounted carousel node. Both effects depend on that node and clean up when it is replaced. The displayed letter ID keys the scan node, so navigation to a new letter resets its position and attaches to the new slides. The hook returns `activeIndex`; React renders the active class and `aria-current` together. Scroll updates are coalesced through one animation frame; container/slide resize and window resize also request a position update. Both center measurements use viewport coordinates. Native touch scrolling, CSS snap, mouse drag, and smooth dot navigation remain in place. No CSS changed.

## Validation

- 15 focused hook/page tests passed. The actual page regression begins with unresolved letter loading, resolves two scans, scrolls to scan two, and checks both class and accessible current state. It failed against the original hook/page code, then passed with the candidate.
- Hook cases cover displaced geometry, scroll-frame coalescing, resize, node replacement, removal cleanup, mouse dragging and click suppression, subsequent simple click, and smooth dot navigation.
- Frontend production build passed. Lint baseline: 102 existing diagnostics, zero increases.
- Browser checks used the candidate frontend at localhost and read-only public GET responses for the two-page letter `0b5e626d-01bb-4026-a4fa-a6ebdf180c7d`; non-GET API requests were intercepted locally. No production writes.
- Chromium and WebKit at 390×844 and 1440×844: first/second dot navigation followed the visible slide; exactly one dot had both active class and `aria-current=true`.
- Chromium at 390×844 with CDP touch emulation explicitly reporting coarse pointer: a native horizontal touch sequence moved the carousel to scan two and updated its dot. This exercises browser input dispatch, not a physical touchscreen.
- WebKit at 1440×844: mouse drag from scan one to scan two updated the dot. The unit test separately verifies the drag's click is suppressed and a subsequent simple click opens normally.

## Limits and manual follow-up

WebKit desktop is not Safari on a physical iPhone. The narrow browser viewports do not prove real-device touch, orientation, browser chrome, or assistive-technology behavior. Check iPhone 13 Safari and Chrome: swipe scans in both directions; tap each dot; rotate; navigate to a different multi-page letter; confirm one active dot and normal page scrolling/image opening. Desktop Safari/Chrome should also retain mouse drag and simple click behavior. No speed, request, or byte improvements are claimed.
