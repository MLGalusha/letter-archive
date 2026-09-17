# Public backlog reconciliation

Baseline: main `5a54cce0`. This separates obsolete descriptions from unresolved symptoms; closing a duplicate does not mean its behavior was fixed.

## Sorting cleanup (#32)

`ARCHIVE_SORT_OPTIONS`, `ArchiveSortOption`, `getDefaultDirectionForSort`, and `getSortDirectionLabel` occurred only in their definitions in `SearchBar/searchBarUtils.ts`. The actual caller uses `COMBINED_SORT_OPTIONS`, which remains unchanged. Removed only those unused definitions (23 lines). TypeScript build and all 1,196 frontend tests passed. No visual behavior change is intended.

## Back-to-search duplicates (#8 / #38)

Both `BackToSearch` and `BackToTop` import `smoothScrollToY`; the helper uses a requestAnimationFrame loop writing through the app-scroll utility. Issue 8 described an older window-scroll implementation. Closed 8 as a duplicate, carrying Home/collection coverage to 38. Issue 38 stays open, with Safari and Chrome coverage including the iPhone 13. Instant movement with Reduce Motion enabled is expected; it is not evidence of the reported bug.

## Archive performance (#50)

Kept open and narrowed to the remaining initial/deep-scroll investigation. Its previous description no longer matched the public list: cards now use one display-sized `PreviewImage`; image lookahead is 1,200px and result-page lookahead 1,800px; `/letters/search` groups and paginates in SQL. Previously loaded cards do remain mounted. That is a scaling consideration, not proof that virtualization is needed for the current catalogue.

The paired preload audit already records fewer early result requests/cards and mixed image-wait outcomes. Image transform contention has its own implementation ticket (#96). Re-measure remaining symptoms after that change; do not duplicate its scope or assume every earlier optimization proposal is still needed.

## Keyboard/header (#42)

The public shell has one fixed scrolling container (`#app-scroll`); the header is fixed outside it. `useHeaderScroll` pins the header visible while an input is focused. In WebKit with an emulated iPhone 13, focusing Home search changed the header from its intentionally hidden scroll state to top 0; `visualViewport.offsetTop` stayed 0. This environment did not open a physical iOS keyboard and cannot reproduce or disprove the reported viewport shift. Leave 42 open pending device evidence; no compensating transform has been introduced.

[VisualViewport documentation](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport) explains why keyboard-related visual viewport changes can differ from layout dimensions. This supports measuring both viewports; it does not establish the cause on this site.

## Mobile filters (#12)

The same live WebKit check did reproduce two acceptance failures: focusing the main search input left the filter panel open, and its inner content was 936px tall inside a 529px client area with `overflow-y: auto`. This is actionable independently of the physical-keyboard issue. Work continues in a separate focused change.

## Manual acceptance

[Public site checks](../qa/public-site-checks.md) contains direct links, steps, expected behavior, and pending versus already-live status. Safari and Google Chrome are project-wide public-site targets. Chromium and WebKit checks supplement physical iPhone 13 testing; they are not interchangeable with it.
