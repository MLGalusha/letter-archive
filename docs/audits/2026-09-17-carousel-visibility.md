# Collection carousel visibility (#133)

The earlier production audit observed two automatic advances and a clone reset
while the mobile collection highlight track was entirely above the viewport.
Autoplay now has a timer only while at least 1% of the carousel intersects the
browser viewport (including clipping by the actual app scroll pane), the document
is visible, and reduced motion is disabled. It uses observation events rather
than scroll polling. Resuming starts a fresh five-second interval and retains the
existing 30-second pause after manual interaction. Single-slide behavior is unchanged.

## Validation

32 focused carousel/showcase/collection tests passed, including timer admission,
cleanup, batched intersection records, hidden state, live motion changes, manual
pause, and existing touch/mouse/single-slide behavior. Four browser checks passed
in Chromium and WebKit using the real collection page and `#app-scroll` with mocked
API responses. Page Visibility state is controlled in those headless tests;
physical phone sleep/background behavior remains a manual check.

An additional real-time Chromium recording used a 390×844 viewport and the same
mocked collection, with separate 12-second visible and offscreen windows:

| Observed activity | Visible | Offscreen |
| --- | ---: | ---: |
| Carousel track style mutations | 3 | 0 |
| Trace timer callbacks | 2 | 0 |
| Trace style updates (`UpdateLayoutTree`) | 50 | 0 |
| Page script duration | 6.407ms | 0ms |

The three visible mutations are advances plus clone repair. This bounded fixture
shows that offscreen autoplay work stops; it is not a production-wide CPU or
battery measurement. Timings vary by device, page content and other work.

To reproduce, run the mocked browser suite with `MEASURE_CAROUSEL=1` and select
`carousel-visibility.mocked.spec.ts` using `playwright.mocked.config.ts`. The
optional Chromium test writes `carousel-activity.json` and a DevTools-compatible
`carousel-performance-trace.json` beneath the test output directory. The trace
contains `carousel-visible-start/end` and `carousel-offscreen-start/end` marks.
The diagnostic is opt-in so normal CI does not wait through real-time profiling.
