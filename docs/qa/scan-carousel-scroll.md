# Horizontal scan paging

Issue #155, baseline 3b6e4a30. September 18, 2026.

Clicking page 2 while the page dots sit at viewport y=260 moved the desktop
document from y=1281 to y=856: a 425px jump, matching the public audit.
`scrollIntoView({block: 'nearest'})` can scroll ancestor containers, including the
document. [MDN scrollIntoView](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView)
explains this ancestor behavior; `nearest` is alignment, not isolation.

The hook now centers a scan by calling `scrollTo` on the carousel itself. Both
centers use viewport coordinates, including its border, matching active-dot
measurement. Native scroll-snap and mouse/touch behavior stay intact. Reduced
motion requests use an instant horizontal move.

Verification: six hook tests and eight browser cases (Chromium/WebKit,
390px/1440px, normal/reduced motion). Page 2 and back to page 1 preserve document
y with less than 0.5px tolerance. No control styling changes in this fix.
Larger page controls and physical touch/trackpad feel remain in #155's design
and device acceptance work; this does not close the whole issue.
