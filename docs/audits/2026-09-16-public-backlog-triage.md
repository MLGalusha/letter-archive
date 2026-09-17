# Public backlog reconciliation

Baseline: main `5a54cce0`. This separates obsolete descriptions from unresolved symptoms; closing a duplicate does not mean its behavior was fixed.

## Sorting cleanup (#32)

`SORT_FIELD_OPTIONS`, `SortFieldOption`, `getSortValue`, and `parseSortValue` occurred only in their definitions in `SearchBar/searchBarUtils.ts`. The actual caller uses `COMBINED_SORT_OPTIONS`, which remains unchanged. Removed only those unused definitions (23 lines). TypeScript build and all 1,196 frontend tests passed. No visual behavior change is intended.

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

## Preview reports (#44 / #45)

An independent check of release `5a54cce0` covered `he`, `Molly`, and `how the kids` at 320px and 390px: 14 cases each in Chromium and WebKit emulation. First highlights were inside the preview and no horizontal overflow or card-box movement was measured. Continuous tap-open sampling (44 Chromium / 23 WebKit frames) also recorded 0px card movement. The old hold-to-preview handlers are absent; an 800ms emulated Chromium hold did not open the application preview. Issue 45 is superseded by the explicit control in PR 102; native browser long-press and physical-device behavior remain separate manual checks.

Issue 44 stays open for a different, reproduced truncation mechanism: a valid 158-character exact transcript phrase returned one match, but only 95 highlighted characters were included before the excerpt ellipsis. Both engines displayed the same cut. The missing text was absent from the API excerpt, so CSS scrolling cannot recover it. The manual checklist links the exact query. These checks do not establish that previews are automatically repositioned when near the viewport bottom.

## Manual acceptance

[Public site checks](../qa/public-site-checks.md) contains direct links, steps, expected behavior, and pending versus already-live status. Safari and Google Chrome are project-wide public-site targets. Chromium and WebKit checks supplement physical iPhone 13 testing; they are not interchangeable with it.
