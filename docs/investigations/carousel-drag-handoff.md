# Carousel drag handoff and homepage overlay

The homepage switches between an introduction and a photograph. Its image overlay was portaled to the entire carousel frame, so crossing the selection midpoint darkened the remaining introduction. The shared carousel now supports slide-local overlays; the homepage uses that option while collection overlays remain anchored to the frame.

Measured normal mouse dragging followed input one-for-one in Chromium and WebKit. Two discontinuities were reproducible: grabbing a settling card forced it to its previous destination, and reversing after an outward boundary drag required undoing the accumulated overshoot before the image moved. The shared mouse/touch handler now cancels settling at its current position, retains gesture ownership while held, and discards travel outside the endpoints. Release still uses bounded settling; native trackpad scrolling is unchanged.

Browser regressions cover re-grabbing and holding, immediate endpoint reversal, homepage overlay geometry, and CDP touch input. In the partial-swipe preview, the image and overlay both started at x=76px and were 343px wide; the introduction remained undimmed. Existing collection stationary-overlay, page-button, responsive, keyboard, vertical-scroll, and click-suppression checks remain in the suite. Physical iPhone Safari acceptance is separate from these browser checks.
