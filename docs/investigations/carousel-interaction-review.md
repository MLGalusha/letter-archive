# Homepage and collection carousel investigation

Date: September 19, 2026 (America/New_York)
Status: original investigation; the user subsequently approved the full proposal, including manual navigation and finite endpoints. See [implementation verification](carousel-implementation-verification.md).
Workspace: `letter-archive-ui-next-pass`, branch `ui-next-pass`.
Baseline: `d076c3348d39ee9953d2f97fcc61da0a6dd7b571`, PR #188's final head. GitHub reported #188 merged during this investigation; deployment was not checked.

## Requested outcome

One consistent swipe interaction for the homepage hero and individual collection highlights. One stationary rounded frame clips square-edged, adjacent slides. No gaps or moving rounded seams. Preserve resting dimensions, text, image crops, overlays, labels, navigation destinations, page counters, and surrounding layouts. Different responsive sizes remain valid.

The Airbnb screenshot establishes the desired visual relationship; it does not establish Airbnb's underlying implementation. Its technology was not inspected.

## Findings and evidence

Both surfaces already use `InfiniteCarousel`. They diverge because each page supplies its own structural CSS through `classPrefix`, and the contents have separate implementations (`HeroLetterCard` and `ShowcaseCard`). Sharing only the JavaScript has not produced one consistent component contract.

Measurements were taken in desktop Chromium at viewport widths 320, 390, 640, 900, and 1280 CSS pixels. The desktop browser reserves 15px for a vertical scrollbar; these are not physical iPhone measurements. Gestures below used mouse input through the same shared drag helpers used by touch. Reduced motion disabled autoplay while measuring.

| Finding | Evidence | Implication |
| --- | --- | --- |
| Homepage gap | At 390px, adjacent card edges were x=219 and x=251 mid-drag: 32px apart. Slides each have 16px horizontal padding. Viewport has -16px margins and no radius; moving cards have 24px radii. | The gap and moving corners are structural, not an image defect. |
| Collection seam | At 390px, adjacent edges both landed at x=219: zero gap. Viewport radius is 0; moving cards have 24px radii. | The cards touch, but their rounded corners cut a notch into the transition. |
| Direction rejection | A gesture starting 24px horizontally / 16px vertically was rejected, even after extending to 160px horizontally. | Early direction classification remains locked for the gesture. Slightly diagonal starts can feel unresponsive. |
| Short swipe rejection | A 60px horizontal drag returned to slide 1. The measured wrapper was 343px wide, giving a 68.6px commit threshold. | Release speed is not considered; distance alone determines success. |
| Trackpad motion is stepped | Wheel handler requires a single event with deltaX at least 30 and then applies a 600ms cooldown. | Small deltas are ignored instead of accumulated; movement does not continuously follow a trackpad gesture. Source finding, not a physical-trackpad measurement. |
| Different settling curves | Home uses 400ms cubic-bezier; collection uses 400ms ease. | The same engine still visibly settles differently. |
| Loop copies have different state | Collection's real highlight was advanced from 1/2 to 2/2; its duplicate stayed at 1/2. | A wrap can display the stale copy before snapping to the real card. State divergence verified; visible flicker not separately recorded. |
| Hidden interactive duplicates | All four rendered collection slides, including loop copies, have links and no inert/aria-hidden ancestor. Homepage contains two h1 elements in carousel mode. | Keyboard and assistive-technology behavior needs a deliberate active-slide policy. |
| Active homepage dot loses reset | Computed appearance is auto on the active dot and none on the inactive dot. The suffix selector stops matching when the active class is appended. | Use stable component classes; do not attribute all physical-device clipping to this one defect. |

Source locations:

- [InfiniteCarousel](https://github.com/MLGalusha/letter-archive/blob/d076c3348d39ee9953d2f97fcc61da0a6dd7b571/frontend/src/components/InfiniteCarousel.tsx): shared drag, wheel, autoplay, clones, controls; drag helpers begin at line 147, wheel at 207, clone rendering at 272.
- [Directional gesture classifier](https://github.com/MLGalusha/letter-archive/blob/d076c3348d39ee9953d2f97fcc61da0a6dd7b571/frontend/src/utils/directionalGesture.ts): 20px threshold and 1.8 horizontal dominance ratio.
- [Homepage structure](https://github.com/MLGalusha/letter-archive/blob/d076c3348d39ee9953d2f97fcc61da0a6dd7b571/frontend/src/pages/HomePage.tsx): HeroLetterCard at line 107, mobile carousel at line 370.
- [Homepage geometry](https://github.com/MLGalusha/letter-archive/blob/d076c3348d39ee9953d2f97fcc61da0a6dd7b571/frontend/src/pages/HomePage.css): viewport and slides at lines 450–497.
- [Collection structure](https://github.com/MLGalusha/letter-archive/blob/d076c3348d39ee9953d2f97fcc61da0a6dd7b571/frontend/src/pages/CollectionDetailPage.tsx): mobile carousel at line 390.
- [Collection geometry](https://github.com/MLGalusha/letter-archive/blob/d076c3348d39ee9953d2f97fcc61da0a6dd7b571/frontend/src/pages/CollectionDetailPage.css): lines 219–244.
- [ShowcaseCard](https://github.com/MLGalusha/letter-archive/blob/d076c3348d39ee9953d2f97fcc61da0a6dd7b571/frontend/src/components/ShowcaseCard.tsx): local page index and image mounting.
- [Dot reset](https://github.com/MLGalusha/letter-archive/blob/d076c3348d39ee9953d2f97fcc61da0a6dd7b571/frontend/src/components/InfiniteCarousel.css): suffix selector at line 8.

Local evidence: `output/playwright/home-audit.txt`, `collection-audit.txt`, `home-mid-swipe.png`, and `collection-mid-swipe.png`.

## Proposed component contract

Replace the prefix-driven structural CSS with a shared carousel that owns:

1. A stationary frame: the sole clipping and corner-radius owner.
2. One horizontal scrolling area: full-width slides, zero inter-slide padding/gap, square slide surfaces.
3. Active-item selection, dots, keyboard navigation, and drag-versus-click handling.
4. Responsive re-alignment using stable item identities.

Pages provide content and size/style parameters, not separate scrolling rules. Text padding remains inside the homepage copy slide; removing the space between slides must not remove the copy's internal padding. Dots stay outside the clipped frame and keep their current visual treatment.

Retain the existing large-screen page composition. The outer mobile carousel is currently used through 640px; at wider sizes the home and collection layouts are static. Sharing behavior does not require turning those desktop layouts into mobile carousels.

The collection contains two levels of navigation: swiping between highlights and arrow buttons changing pages within a highlight. Preserve that distinction and the existing arrow actions. Do not add nested horizontal swipe handlers or flatten all scan pages into the outer carousel without a separate design decision. Shared presentation and page-selection helpers can remove duplication between the two media-card implementations without forcing identical content markup.

## Recommended scrolling approach and behavior choice

Use native horizontal scrolling with CSS scroll snap for touch and trackpad. Remove the custom touch-direction classifier, distance-only commit threshold, React state updates on every touch movement, and wheel cooldown. Browser scrolling provides the movement; JavaScript tracks the selected slide and handles buttons. Add a small mouse-only drag adapter with pointer capture if preserving click-and-drag on a desktop mouse, and suppress only the click belonging to an actual drag. Keep vertical page scrolling and pinch zoom available, and retain protection against the collection page's whole-page swipe navigation.

Native scroll snap defines paging positions within an actual scroll container. It does not guarantee identical gesture physics across browsers: [MDN CSS scroll snap](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll_snap). Selected-state synchronization should feature-detect `scrollend` and include a compatible fallback rather than relying exclusively on newer snap events: [MDN scrollend](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollend_event).

My preferred product behavior is manual navigation with a real beginning and end. This removes autoplay timers, duplicate slides, and wrap-reset synchronization, with the largest reduction in complexity. **Stopping autoplay and removing endless looping are optional behavior changes beyond the requested styling, not assumed authorization.** Dots/buttons keep every slide reachable, including return to the first slide.

If autoplay and seamless looping must remain, keep them as explicit requirements and validate a maintained carousel engine before committing to the implementation. Native snapping alone does not supply seamless infinite looping. Avoid replacing the existing custom clone system with another ad hoc clone system. Any retained rotation must pause during interaction/focus and offer a pause control; this may introduce a visible control and therefore needs a design decision. [W3C carousel pattern](https://www.w3.org/WAI/ARIA/apg/patterns/carousel/).

## Additional improvements worth including

- **Correct focus and slide semantics.** Only the intended slide content should be reachable; preserve keyboard activation and modified link clicks. Use ordinary labeled picker buttons unless implementing the full tabs keyboard pattern. Increase invisible dot hit areas without enlarging their visible circles.
- **Predictable image readiness.** Share the existing progressive-image behavior and prepare only the current and adjacent media as appropriate. ShowcaseCard currently mounts only its selected image; a newly selected page may need to load then. Preloading must be bounded and verified, not claimed as a measured performance win yet.
- **Stable selection.** Store media selection by stable item identity, clamp when data changes, and preserve it across responsive remounts where the same item remains. This addresses the demonstrated clone divergence if looping is retained and avoids avoidable resets on resize.
- **Interruption correctness.** Verify rapid reversals, new input during settling, cancellation, and clicking after a drag. The current animated flag serves both drag and clone-reset duties; its effect re-enables animation via animation frames, so it is not a clean dragging state. Actual frame-time impact remains unmeasured.

## Implementation sequence and acceptance

1. Resolve only the autoplay/looping behavior choice; preserve all other current content and navigation semantics.
2. Build the shared frame/scroll/controls component and convert the two mobile surfaces. Keep dimensions and page-specific presentation parameters explicit.
3. Consolidate media navigation/image preparation where behavior matches, and correct dots/focus/state handling.
4. Replace obsolete assertions that require the homepage to paint all the way to screen edges: the requested invariant is now containment inside the fixed rounded frame. Keep unrelated reader tests intact.
5. Verify at 320, 390, 430, 640, 641, 900, and 1280px, including equal resting bounds, zero seam gap, no slide radii, stable page height, and no page overflow. Exercise one/zero/many items, long copy, delayed images, image errors, data changes, keyboard, reduced motion, pinch, vertical scrolling, diagonal starts, short flicks, repeated/reversed gestures, arrow controls, and drag-versus-link activation.
6. Compare Chromium and WebKit; test on physical iPhone Safari, Home Screen mode, and Chrome separately before claiming the swipe feels right. Browser automation can establish geometry and regressions; it does not establish physical-device feel.

Expected result: the same content sits inside one stationary rounded window on each page; transitions show one straight seam with no background gap; both surfaces use the same interaction implementation. The proposed native approach removes several custom gesture mechanisms, but smoother physical-device behavior remains an acceptance criterion, not a completed result.
