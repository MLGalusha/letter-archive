# A3 reading-first public reader

Selected by the user September 18, 2026. Base release: `9a124d88fd20c4e8b5d3ea67dd6c262b70316249`.
Addresses #153, #154 and the scan controls/loading strip portions of #155/#152.

## Structure and content

The document owns vertical scrolling. One page lane owns gutters and header
clearance. Desktop gives text twice the scan column width; at 900px and below
a 240px-high, fully contained scan preview precedes the transcript. The summary
is an optional native disclosure. Metadata always has a visible heading fallback.
Missing scans do not hide published text; missing transcripts have explicit copy.
Photo descriptions and additional documents remain distinct sections.

Saved reading text is rendered verbatim. Existing reflow is retained for page
text, and original formatting remains available. Source buttons open the exact
associated image in the existing viewer; closing restores focus and reading
position. Every associated extra-item image is reachable. No paragraph/region
mapping is fabricated. Numbered semantic margin notes require verified published
anchors, which the current public contract does not supply (#111/#53); raw admin
OCR remains private. No backend projection or publication gate changes.

The old floating/parallax thumbnails, duplicated image/text layouts and fixed
hero offsets are removed. The shared header measures its real height with and
without a scrubber. Pending detail feedback is a 3px non-flow indicator rather
than a white loading strip. Persistent scrubber ownership remains #152 work.
Rapid page 3 → page 1 selection reproduced a WebKit snap interruption failure.
Removing snap during explicit paging isolated the cause. The carousel now restores
native snapping when its requested target settles, or when a touch/wheel gesture
starts; an old scrollend cannot override a newer target. No timer/easing loop.
The rendition resize test now waits for the actual page 1 position instead of
its already-cached image URL before resizing.

Bottom adjacent-letter links remain until #158 provides a dependable replacement.

## Entry policy

Direct links and home/collection highlight links open at the top. Header letter
switches use normal route navigation. `?image=` selects that scan immediately,
without timers or document motion. It stays in the URL for repeat visits and
Back/Forward. Unknown image IDs use the first scan. The shared ScrollToTop owner
retains browser-history restoration. User-selected scans use local horizontal
scrolling, with reduced-motion support; the viewer owns zoom and fullscreen.

## Evidence and research

- Baseline audit: sparse date overlapped the header by 3.20px at 901/1280/1440;
  rich mobile scan began at y=957. Highlight entry moved the document even with
  reduced motion. Recorded in #153/#154.
- Three new unit regressions failed before implementation: visible date heading,
  published text without scans, and separate extra documents with all sources.
- Browser regression fixtures exercise 320/390/900/901/1440, source selection,
  long notes, summary, complete portrait geometry, header clearance, no overflow,
  no forced entry scrolling, and source-view return in Chromium and WebKit.
- Chromium with root text size doubled at 320/900/901/1440px kept heading
  clearance at 32.3px (mobile) / 48.2px (desktop), with no horizontal overflow.
  This is CSS text enlargement, not a physical browser zoom certification.
- Review regressions preserve single-page mapped source links, photo-primary
  workflow gating, and page-text fallback for whitespace-only saved reading text.
- Final CI reproduced a safe-area regression: adding 47px of header padding
  moved the header but not content clearance. Observing the header border box
  instead of its content box fixes padding-only changes; the unchanged inset
  and rotation test passed 3/3 bounded local runs without retries.
- Existing viewer focus, local scan paging, rendition/preview scheduling, failure
  fallback and history tests are retained. The smaller preview now measures its
  own contained width, bounded by its parent: phone DPR3 requests 800px instead
  of the former 1200px rendition. Desktop preview handoff tests use DPR2 to keep
  exercising a larger requested rendition than the cached 480px card preview.

Primary references checked September 18, 2026:
[MDN element scrollTo](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollTo)
for scrolling only the horizontal owner;
[MDN object-fit](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/object-fit)
for uncropped scans;
[MDN details](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details)
for native summary disclosure. These document mechanisms; the A3 composition is
the user's product choice, not a browser specification requirement.

## Delivery and remaining acceptance

Local/CI/review/live results are recorded in the PR. Browser automation measures
layout and interaction; physical iPhone Safari, Home Screen/PWA, browser toolbar
changes, touch feel and VoiceOver remain manual acceptance, not certified by
viewport emulation. Structured semantic notes and fullscreen gesture redesign
remain separate work.
