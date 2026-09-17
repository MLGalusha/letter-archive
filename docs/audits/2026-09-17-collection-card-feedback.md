# Collection card feedback (#49)

Both Chromium and WebKit with an iPhone 13 profile reported `hover: none` and `pointer: coarse`, yet a real tap activated the unqualified card `:hover` rule. The card stayed translated upward 2px for at least two seconds after release. Navigation was deliberately canceled for this observation so the card remained measurable. A separate ordinary single-tap check navigated correctly in both engines. This is a reproducible feedback mismatch, not a routing defect or complete explanation of the subjective original report.

The change is CSS only: retain the existing lift for hover-capable fine pointers; give active cards immediate border/shadow feedback without adding translation/scaling; disable transition/lift with reduced motion. Native links, route timing, focus behavior and card dimensions are unchanged. No pointer handlers, navigation delays or animation state were added.

| Observation | Before | After |
| --- | --- | --- |
| Touch tap, both engines, after release | Persistent -2px lift | No transform, even while browser retains :hover |
| Desktop mouse hover | -2px lift | Existing lift retained |
| Desktop held press | No distinct rule | Immediate darker border/shallower shadow; same position as hover |
| Reduced-motion hover/press | Existing lift permitted | No transform or transition |
| Keyboard and normal tap | Native link | Enter and single tap still navigate; keyboard focus ring remains visible |

Browser checks used the actual local frontend with read-only public API metadata and synthetic image responses. Chromium's held-touch probe did not expose an active state before release, so the new active visual was verified with a held mouse press; physical mobile feedback remains a manual acceptance item. Desktop focus was visibly indicated by its computed native outline. Raw numeric observations and replay outputs are retained under this worktree's `output/playwright/collection-card/`. No component test was added to mirror CSS; the production build and lint baseline passed (102 existing diagnostics, no increases).

After deployment, open [Collections](https://voicesthatremain.com/collections) in Safari and Chrome on the iPhone 13. Tap a card: it should navigate on the first tap without the mouse-style lift. On desktop, check hover, press and keyboard Enter. With Reduce Motion enabled, the card should not lift. The observed change addresses the concrete input mismatch; the overall feel and physical-device acceptance remain pending.
