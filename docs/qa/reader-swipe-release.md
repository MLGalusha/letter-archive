# Fullscreen swipe release continuity (#157)

The reported gesture follows the finger, then appears to jump on release. A
warm-image browser fixture isolates animation from downloads: drag the carriage
120 CSS px, pause 120ms, then release. At a 390px viewport the stage is 358px wide.
The compositor animation is paused and sampled at exactly 16ms to avoid confusing
host scheduling delays with interpolation speed.

| Engine | Old displacement at 16ms | New displacement at 16ms | Destination error |
| --- | ---: | ---: | ---: |
| Desktop Chromium | 67.166px | 7.264px | <0.001px |
| Desktop WebKit | 67.166px | 7.264px | <0.001px |

The old fixed ease-out curve launched a stationary release with a steep initial
slope. The replacement derives its initial slope from the existing recent finger
velocity. Paused or opposing motion starts at rest; forward motion carries its
speed into settling, capped near the destination to prevent overshoot. Linear
Bézier time controls and a terminal horizontal tangent provide a bounded,
continuous path to the existing page boundary. Duration, gesture thresholds,
page commits, interruption, pinch ownership and reduced-motion behavior remain
unchanged. This is not a new gesture engine.

[MDN cubic-bezier documentation](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/easing-function/cubic-bezier)
explains how time/progress control points define the curve and how out-of-range
ordinates can overshoot. The release-speed calculation and measured improvement
are project-specific engineering evidence, not an MDN-prescribed animation.

Validation: the browser regression fails with the old curve in both engines and
passes with the new curve. The focused browser suite passes 34 checks with two
intentional CDP-only skips; 21 viewer unit tests include 0.25 and 1.5px/ms speed
handoffs, cancellation, pinch takeover, interrupted settling and reduced motion.
Physical iPhone slow drags, flicks, reversals and perceived smoothness remain an
acceptance check. This result does not certify cold image delivery or native
browser-toolbar animation.
