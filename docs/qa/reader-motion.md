# Reader motion: coordinated paging, thumbnail detents, and pinch scheduling

Approved September 18, 2026. Follow-up to #177; tracks #155 and #157.

## Baseline and cause

On deployed revision `4adf865e16ae83729969d06e50ed678438a13114`, a desktop Chromium touch probe at 390×844 found:

- Fullscreen image motion ran from approximately 68ms to 802ms; the strip started at 834ms and finished at 934ms. The strip only received committed integer selection, so it could not follow the image during its gesture.
- Inline image motion began at 93ms; the strip began at 442ms after the selected page changed near the halfway point.
- Native strip overflow delegated momentum to the browser, without any adjustable resistance.
- Pinching from 100% to 275% replaced the image source twice during the gesture. That desktop run stayed smooth (largest sampled frame gap 17.6ms). It did not reproduce the user's occasional iPhone choppiness.

Probe and raw results are retained locally under `letter-archive-centered-pages/output/playwright/centered-pages/motion-audit*`. These are desktop observations, not physical iOS measurements.

## Implementation

Transient fractional page progress synchronizes the main scan and filmstrip without making every animation frame a React selected-page update. Fullscreen follows the rendered carriage during the existing swipe settlement. Inline follows native carousel progress. Tap and keyboard selection retain their direct page selection and a short thumbnail recentering animation. Cancellation returns to the committed page. Main-image wraparound holds the strip endpoint then relocates on commit instead of rewinding across the document.

The shared strip owns horizontal pointer dragging; native vertical page scrolling and keyboard navigation remain available. Release velocity is bounded, coasting decays with additional damping near page centers, and a short settle centers the final page. Grabbing cancels the running animation. The main image changes once strip browsing settles. Trackpad/wheel scrolling retains native snapping. Width changes recalculate positions; an initial ResizeObserver notification no longer cancels animation when width has not changed.

Pinch/pan updates are batched to animation frames. The displayed rendition remains stable during a pinch, then the existing progressive-image path requests suitable detail on release. The shared thumbnail subtree is memoized. These remove observed sources of gesture-time work; physical iPhone confirmation remains necessary before claiming the intermittent choppiness is resolved.

## Acceptance

- Partial main-image drag moves thumbnails before page selection changes, in both modes.
- Reversal, cancelled swipes, interruption, wraparound, and resizing leave the selected thumbnail centered.
- A 24-page strip can be grabbed mid-coast and reversed without a jump; selection waits for settlement.
- Slow drag, short flick, reduced motion, keyboard Home/End/arrows, and vertical reading scroll remain usable.
- Pinch keeps its image source throughout gesture while percentage/transform continue changing; after release detail upgrades and paging still work.
- Existing viewport, focus, rendition admission, safe-area, and scrolling regressions remain gates.

Physical iPhone Safari and Home Screen checks: try the same slow swipe, quick flick, mid-coast grab, rapid reversal, and pinch on a long letter. Tune the subjective detent strength from that evidence. Landscape header redesign remains deferred.

## Research

- [MDN: scroll-snap-type](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/scroll-snap-type): the browser controls snap physics; content changes can cause resnapping.
- [MDN: scroll-snap-stop](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/scroll-snap-stop): `always` prevents passing snap points; it does not provide adjustable friction and would limit fast traversal of long documents.
- [Google web.dev: animation performance](https://web.dev/articles/animations-guide): prefer transform/opacity, measure rendering costs, and use compositing hints selectively.
