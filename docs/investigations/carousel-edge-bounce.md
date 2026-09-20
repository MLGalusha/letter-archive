# Firm carousel endpoints

The shared CardCarousel viewport used `overscroll-behavior-x: contain`. That prevents scroll chaining but retains local boundary effects, including Safari's horizontal rubber-banding shown in the phone screenshots. Changed the shared rule to `none`, which also disables local boundary effects. No new JavaScript gesture interception, slide geometry change, or vertical scrolling rule is needed.

Reference: [CSS Overscroll Behavior specification](https://drafts.csswg.org/css-overscroll/#valdef-overscroll-behavior-none). Safari support: [WebKit Safari 16 announcement](https://webkit.org/blog/13152/webkit-features-in-safari-16-0/#overscroll-behavior).

Chromium and macOS WebKit: both homepage and collection first/last slide edges stay flush during outward mouse drags. Normal native touch paging (Chromium CDP), horizontal wheel paging, and vertical wheel scrolling continue to pass: 7 checks passed, with the existing CDP-only WebKit skip. Build passed. These browser checks do not reproduce physical iPhone rubber-banding; the refreshed phone preview is ready for that acceptance check.
