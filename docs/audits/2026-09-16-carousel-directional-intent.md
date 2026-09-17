# Carousel directional intent — issue #10

Base: `5a54cce0`. This change shares the existing page-swipe decision (20px movement, horizontal delta greater than 1.8 times vertical delta) with `InfiniteCarousel`. It changes gesture ownership, not carousel layout or animation design.

## Diagnosis and scope

`InfiniteCarousel.moveDrag` previously called `preventDefault()` even before its 8px decision, and accepted horizontal motion without the page-swipe ratio. Three added regressions failed on the original code: undecided movement canceled browser handling, a canceled horizontal drag could commit a slide, and a two-finger gesture was intercepted. The component is used by Home's hero and CollectionDetailPage's highlights.

The issue's LetterDetailPage reference is stale: current scan images use native horizontal overflow/scroll-snap through `useCarouselDrag`, with `data-swipe-ignore`. Those touch interactions are left native. Removing whole-letter navigation (#21) and changing the fullscreen viewer's zoom/pan/animation (#23) remain separate.

## Policy

- A small pure `decideGestureAxis` helper keeps the page-swipe threshold unchanged. Each caller freezes its decided axis for the gesture.
- The carousel does not move or cancel browser handling while undecided or vertical. Only a committed horizontal direction consumes movement and suppresses the resulting drag click. Ordinary taps and existing mouse/keyboard link activation remain available.
- A second finger or `touchcancel` clears the partial drag without changing slides or navigating a page. Remaining single-finger events cannot revive that gesture.
- The carousel track declares `touch-action: pan-y pinch-zoom`, overriding Home's prior `pan-y` restriction. Control-wheel pinch gestures remain browser-owned. Fullscreen image zoom code is unchanged.
- Mutable drag distance supplies the final position without reattaching listeners on every finger move. No new gesture library, pointer capture framework, manual page scrolling, or fullscreen transition system is introduced.

MDN explains that [touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action) declares browser gesture ownership before listeners run, and [touchcancel](https://developer.mozilla.org/en-US/docs/Web/API/Element/touchcancel_event) can terminate an in-progress touch. These are reasons to preserve browser handling and clear partial gestures, not proof of behavior on every phone.

## Browser observations

Local Vite candidate at port5187; baseline at5188 is `5a54cce0` with only unrelated unused-sort definitions removed. Both read the public catalogue through GET-only response interception for local CORS. Other methods were fulfilled locally without production writes. Reduced motion disables automatic slide changes for comparison. These are functional observations, not performance measurements.

Chromium used native CDP touch input at390×844 CSS pixels/DPR3 (`navigator.maxTouchPoints=1`), emulating an iPhone-sized viewport:

| Gesture | Baseline | Candidate |
| --- | --- | --- |
| Collection003 shallow diagonal, six45ms steps totaling144px right /120px up | Scroll0; incorrectly changes Slide1→2 | Scroll0; remains Slide1 |
| Collection003 steeper diagonal, eight45ms steps totaling120px right /144px up | Scroll132px; remains Slide1 | Scroll132px; remains Slide1 |
| Home vertical motion with48px right /224px up | Not sampled | Scroll209px; remains Slide1 and same route |
| Home intentional horizontal swipe210px left /12px down | Not sampled | Slide1→2; scroll0 and same route |
| Collection003 two-finger pinch | Not sampled | Browser scale1→approximately1.5; remains Slide1 |

**Native-axis limit:** Chromium still chose no vertical page scroll for the horizontally dominant shallow-diagonal start, even after the candidate declined ownership. A follow-up trajectory that bent vertically also did not scroll. The improvement observed there is removal of the accidental slide change. This patch does not force the browser to reinterpret a gesture after its own axis decision. The steeper-diagonal control worked before and after; it is not claimed as a newly fixed case.

WebKit at390×844/DPR3 reported `maxTouchPoints=0`, despite the requested phone device profile. Its Touch constructor also rejected construction. Therefore its check used explicit synthetic DOM touch-shaped events: undecided/diagonal events remained uncanceled, vertical lock persisted, and horizontal input changed Slide1→2. This confirms handler behavior in WebKit but **does not establish native touch scrolling, pinch, or physical Safari behavior**. Local captures are `output/playwright/gesture10-*.txt`; they are not needed to understand the table.

## Validation and remaining acceptance

Focused component/hook/page tests cover tap/drag click suppression, vertical/horizontal axis lock, threshold preservation, cancel/multitouch, ignored carousel boundaries, focused text inputs, trackpad pinch, and existing page/carousel behavior. The final run passed all42 focused tests, the production build, and the lint regression gate (102 existing diagnostics; no increases).

Physical iPhone13 acceptance remains required in both Safari and Chrome: scroll naturally over Home and collection highlights, intentionally swipe horizontally, tap links after a drag, pinch the page, and confirm native letter-scan scrolling plus fullscreen pinch still behave normally. Browser emulation and synthetic events do not establish iOS gesture feel, compositor behavior, or physical-device responsiveness. The root-owned manual checklist tracks those steps separately.
