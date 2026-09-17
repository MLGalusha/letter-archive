# Static single highlights (#20)

Base: `5c7a9654` (main). Scope: shared InfiniteCarousel cardinality, covering the collection's mobile highlight row without changing collection selection or gallery semantics.

## Cause and change

The previous carousel skipped its auto-advance interval for one child but still built both clones and installed touch/wheel/mouse interaction. A collection with one featured card could therefore drag or loop back to itself.

The component now normalizes its children with `Children.toArray` (excluding null/undefined/boolean placeholders). Zero items render nothing. One item renders once inside the existing styled wrapper/viewport/slide, with no track, transform, dots, drag handlers, or carousel effects. Multiple items mount the existing rotating implementation as a child component. Crossing that boundary mounts/unmounts the interaction state rather than trying to preserve stale positions and listeners on a different DOM structure. The exposed pause callback is reset when the rotating component leaves.

A gallery is one outer card even when it contains several images. Its own Previous/Next buttons and image-specific link remain intact; the change removes only pointless movement between identical outer cards. No CSS, collection-selection, image URL, or search changes.

## Validation

- 29 focused tests passed across InfiniteCarousel, ShowcaseCard, and CollectionDetailPage; production build passed; lint reported 102 existing diagnostics and zero increases.
- New tests cover zero effective children, a singleton mixed with empty placeholders, no interception of touch/wheel/mouse, ordinary link activation, 1→many→1→many lifecycle, automatic advancement after re-entry, and a singleton gallery's internal image controls/native destination.
- The singleton regression failed on the original component (extra slide wrappers/clones) and passed on the candidate.
- Chromium and WebKit, 390×844 and 600×844: a locally reduced collection003 overview containing one letter/one image rendered exactly one card, zero tracks/dots, no horizontal page overflow, and a working link to its letter/image. Synthetic touchmove and wheel events were not canceled. This fixture exercises the real collection page; it is not a production catalogue change.
- Both browser engines also loaded the unchanged multiple-card collection003 response: two outer dots/four slides including the existing clones, and selecting the second dot selected the second card.
- Chromium CDP touch emulation explicitly reported coarse pointer. A vertical gesture starting over the static card moved `#app-scroll` from0 to175px; the card remained a single static item. This is browser-emulated native input, not physical iPhone evidence.
- Browser script and outputs remain local under `output/playwright/check-single-highlight.js`, `single20-chrome.txt`, `single20-webkit.txt`, and `single20-native-scroll.txt`. API reads used public GET responses; non-GET requests were intercepted locally. No production writes.

## Limits

WebKit checks use the desktop engine at phone-size viewports and synthetic events; they do not prove physical iPhone Safari/Chrome touch or browser chrome behavior. Verify a singleton collection on iPhone13: vertical scrolling, ordinary tap, and no sideways outer-card movement; then verify a collection with a gallery still supports both outer carousel navigation and gallery image buttons. Shared Home usage also gets the static behavior if it ever supplies only one effective item. No performance timing or byte-saving claim is made.

## PR review follow-up

The static wrapper initially retained `data-swipe-ignore` despite owning no gesture handler. Review caught that this blocked the collection page's existing horizontal navigation over the single card. Removed the marker only from the static branch; rotating carousels retain their gesture boundary. An integration regression with the real page-swipe hook verifies that a deliberate horizontal swipe reaches adjacent-collection navigation while no carousel track exists. All 19 carousel tests pass after this adjustment. Vertical scrolling and ordinary links remain native.
