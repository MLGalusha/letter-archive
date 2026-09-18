# Image-first phone reader and centered pages

User approved the final portrait concept and numbered inset notches on September 18, 2026. This supersedes the P2 toggle-based picker in #175, and continues #155 / #157.

## Scope

- Regular mobile reader: original scan first beneath existing navigation, then filmstrip, metadata/summary and transcript. Keep desktop's established reading/scan columns.
- Remove mobile's fixed 15rem scan-height cap. Size the stage from available container width and active scan metadata, using the existing .75 fallback when dimensions are absent; image fitting preserves the actual rendition aspect ratio.
- Both reader modes share one horizontal strip. Active page centers, including endpoints, with a selection border and a bottom-center number notch inside its thumbnail.
- Tap or keyboard selection updates the scan directly and recenters the strip. Native strip scrolling selects only after settling; main-image paging recenters the same strip. Reduced motion uses instant recentering.
- Always show the strip; remove toggle, next/previous page buttons and separate visible counter. Preserve a screen-reader page announcement and desktop zoom controls.
- Preserve pinch/pan, image request admission, bounded thumbnails, fullscreen safe areas and document scroll restoration.

## Research and implementation rationale

[MDN scroll-snap-align](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/scroll-snap-align) defines center alignment inside the scroll container. Use native snap plus end spacers instead of a second custom swipe engine.

[MDN scrollend](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollend_event) distinguishes completed gestures from intermediate scrolling, and notes no event fires when position does not change. Use scrollend where available with a bounded idle fallback for older engines; distinguish user browsing from programmatic recentering, and wait for touch release even after native scrolling cancels pointer events. Direct taps still select without depending on scrollend.

## Validation

Regression coverage exercises 24-page direct selection, native horizontal wheel settling, endpoint centering, resize, keyboard Home/End, notch bounds, unchanged document position, trusted CDP touch release, existing pinch/rendition swaps, cancellation, safe areas, and failed image handling. Native reading-scroll assertions remain in Chromium and the required macOS WebKit CI job.

Real public data can be previewed locally through an automation-only CORS response-header adaptation; this is not a live deployment or device acceptance. Physical Safari, Home Screen, Google app and Chrome acceptance remains distinct from desktop WebKit/Chromium evidence.

## Deferred explicitly by the user

Landscape phone navigation can consume too much vertical space. Investigate rotation polish and a compact/collapsible navigation arrangement later; side-mounted/pop-out navigation was brainstorming, not an approved implementation. Do not redesign the global header here. Preserve baseline landscape safety and reachability while shipping the portrait change.
