# iPhone reader viewport follow-up (#172)

## Physical evidence supplied September 18, 2026

User reports iOS 26.6.2; Safari tab, Safari Home Screen, Google app, and Chrome
must remain separate acceptance environments. App versions are unconfirmed.
The supplied originals are 1170 by 2532 pixels. Pixel comparison, not visual
estimation, gives these results:

| Screenshot | Observation |
| --- | --- |
| `Letter, January 27th, 1878  Voices That Remain.png` and `...Remain 2.png` | Every pixel below y=141 is identical. Only the status area changes: cream to viewer dark. No scan or toolbar displacement between these captures. |
| `IMG_6427.PNG` | Dark viewer ends at y=2391, leaving 141px of the document's #f5ede1 cream below it. This is the older, two-row toolbar release; user reports the gap persists. |
| `IMG_6430.PNG`–`IMG_6432.PNG` | Google host chrome starts the web surface at y=309. Viewer ends at y=2382, leaving 150px in the host's #22242a color. Native bottom buttons are not visible. |
| `IMG_6433.PNG` | Same y=309 start, viewer ends at y=2142 with native buttons visible below. The boundary differs by 240 image pixels from the other Google captures. |

At an assumed 3x pixel ratio, 141px corresponds to 47 CSS px, but the screenshots
do not expose viewport APIs or prove which sizing rule creates the Home Screen
strip. The Google images show that the viewer does resize between native-toolbar
states; they do not prove that native toolbar collapse itself is a site defect.
No Chrome screenshot is identified separately in this batch.

## Baseline and correction

Verified baseline: a79356b61e579374f3baa411ac13b5f9f264e119. Live desktop Chromium
and WebKit probes each sampled five open/close cycles and height changes: 178
samples per engine, 93 with viewer open, no reported viewport coverage gap, and
cream root/body/theme values throughout. These are desktop-engine observations,
not physical iPhone acceptance. Artifacts live in the prior audit worktree under
`output/playwright/reader-followup-diagnosis/`.

The correction makes the fixed viewport the single sizing owner, removes the
backdrop's competing dvh height, and moves temporary reader surface ownership to
`useReaderViewerSurface`. Before the opening paint, root and body backgrounds and
existing theme-color hints match the actual backdrop color; root/body scrolling
is locked. Prior inline property values/priorities and metadata are restored on
close/unmount, with same-route reading restoration. Safe-area padding remains
inside the modal, and ordinary public-page scrolling is untouched while closed.

Cancelable movement on modal chrome is prevented locally. The image stage keeps
its gesture handlers, the thumbnail drawer keeps native scrolling, and Ctrl+wheel
browser zoom is not intercepted by the outer listener. There is no global touch
listener, status-bar metadata change, user-agent branch, arbitrary notch offset,
or continuous VisualViewport compensation.

The root-color correction addresses the confirmed mismatched surface state. The
fixed-edge sizing change removes two competing geometry rules. Neither is being
claimed to prove the unobserved physical Home Screen geometry mechanism.

## Research informing the boundaries

- [WebKit 301756, engineer comment 2](https://bugs.webkit.org/show_bug.cgi?id=301756#c2):
  surrounding edge colors depend on fixed/sticky edge elements. Safari's native
  fill is not completely controlled by a page's theme-color metadata.
- [WebKit 297779, engineer comment 23](https://bugs.webkit.org/show_bug.cgi?id=297779#c23):
  browser controls can define the usable fixed bottom edge; color fill beyond
  that edge is browser-controlled. Do not cover native controls with fake space.
- [Google dynamic viewport guidance](https://web.dev/blog/viewport-units): dvh
  updates may be throttled during native toolbar transitions.
- [MDN VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport):
  measure visible viewport dimensions/offset separately from the layout viewport.
- [WebKit Safari 26.1 notes](https://webkit.org/blog/17541/webkit-features-for-safari-26-1/):
  an earlier fixed-container gap was fixed; old reports are not proof of a cause
  on the user's reported 26.6.2 build.

## Automated checks and physical acceptance

The new surface/gesture tests failed against the old implementation, then passed.
Focused Chromium/WebKit viewer suite: 42 passed, 2 intentional CDP-only skips,
zero retries. Production frontend build passed. CI/release evidence belongs in
the PR and issue so it can reference the final revision.

Automated coverage includes repeated color/lock restoration, changing viewport
height, reachable controls, prior inline `!important` color and custom metadata
restoration, a scrolled close, route exit, focus ownership, simulated safe areas,
pinch rendition changes, zoomed panning, and drawer navigation. Synthetic gesture
cancellation checks establish ownership, not native iPhone momentum behavior.

Keep #172 open until the following are checked on the phone after release:

- Same letter, same initial position across Safari, Home Screen, Google and Chrome.
- First open and ten open/close cycles, both near top and after scrolling.
- Dark edge continuity and no Home Screen dead strip; controls clear safe areas.
- Native toolbars expanded/collapsed, slow drag and reversal, portrait/landscape.
- Dragging chrome does not move the page; image pinch/pan and drawer scroll work.
- Close returns to the same text; background/resume and Back/Forward unlock cleanly.

If a strip remains, record screen pixels together with innerHeight, clientHeight,
visualViewport height/offset, safe-area values, and overlay/control rectangles.
Do not declare it fixed from a recolored screenshot or desktop geometry alone.
