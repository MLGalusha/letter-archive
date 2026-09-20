# Upload CSS isolation browser acceptance

Issue: [#191](https://github.com/MLGalusha/letter-archive/issues/191)

Independently checked implementation `1632a546` in Chromium through Playwright CLI against the Vite application at `http://127.0.0.1:4186`. API responses, authentication, event streaming, and one letter/image were local browser fixtures. Navigation used the application's sidebar links and dashboard letter row; page styles were the actual lazy-loaded stylesheets.

## Navigation and stylesheet order

At a 1280 px viewport:

| Check | Before Upload | After Upload |
| --- | --- | --- |
| Dashboard collection input | 343.625 × 34 px | 343.625 × 34 px |
| Input padding / font / radius | 0 11.2 px / 14 px / 4 px | Identical |
| Input background | rgb(242, 242, 242) | Identical |
| Letter review header actions | 80 × 36 px, 8 px gap | Identical |
| Review header buttons | Each 36 × 36 px | Identical |

Verified these SPA routes:

- Dashboard → Upload → Dashboard, comparing the collection filter input before/after.
- Fresh Letter review → Upload → Dashboard → Letter review, comparing review controls before/after. Relevant stylesheet order: `Modal.css`, `LetterReviewPage.css`, `UploadLetterPage.css`, `AdminDashboard.css`.
- Fresh Upload → Dashboard → Letter review, producing the same measurements with order: `Modal.css`, `UploadLetterPage.css`, `AdminDashboard.css`, `LetterReviewPage.css`.

The Upload header actions render outside the upload page root and retain `display: flex`, centered alignment, and a 16 px gap. This directly exercises the ownership boundary that descendant-only scoping would miss.

At a 390 × 844 px viewport after Upload navigation, review actions remain 80 × 36 px with 36 × 36 px buttons and an 8 px gap. The dashboard collection input measures 269.625 × 34 px with the same padding/font/radius. Neither page has document-level horizontal overflow in these checks.

## Actual shared confirmation dialog

Opened Dashboard → select fixture letter → Danger → Delete, then cancelled without confirming deletion.

- At 390 px, the shared `.modal-content.modal-sm.confirm-dialog` measures 342 px wide and reports `max-width: 400px`.
- At 1280 px, it reports `max-width: 400px`; its rendered outer width is **464 px**, including the existing 32 px padding on each side under `content-box` sizing.
- Moving the actual Upload stylesheet last, then moving the actual shared Modal stylesheet last, leaves both values unchanged.
- Disabling Upload styles entirely also leaves the 464 px rendered width unchanged. The outer width is existing shared-modal sizing, not an Upload override.

These measurements distinguish the 400 px CSS maximum from the padded rendered box.

## Limits and separate observations

This receipt covers navigation/style isolation and targeted browser geometry. It does not establish real upload persistence, every results/duplicate dialog state, physical-device feel, Safari behavior, production deployment, or remote CI. The implementation's component regression and uploader dialog checks are separate evidence.

The initial empty-image review fixture exposed an existing unrelated `LetterViewer.tsx` null-aspect path (`loadedAspect?.url === currentImage?.imageUrl` can compare two undefined values before reading `loadedAspect.ratio`). A valid mocked image was supplied for this acceptance run; application source was not changed.

## PR review and CI correction

Initial CI run `35489171246` on `c8096ca6` failed two upload tests because they still selected `.header-stats`. The tests now use the uploader-owned selector; the non-mocked collection-input fallback is updated too. No expectations were weakened. Three retry-free Chromium repetitions passed 15/15 cases, followed by 5/5 on the final upload suite after adding close-button coverage.

Review comment `discussion_r4056119952` correctly identified a lost inherited `line-height: 1` on the renamed modal close/back control. Direct CSS regression failed before the restoration and passed afterward. The real browser also verifies computed line height equals the button's 24px font size. The coordinator independently reviewed the final correction.

That initial CI run also recorded one unrelated WebKit reader-focus geometry attempt (478.5px → 478px width; x480.75 → x481) which passed its configured retry. The reader test is identical to main and neither this PR nor PR189 changes its implementation. The exact scenario passed one local retry-free WebKit check. This establishes intermittency, not a root-cause fix; it is recorded separately rather than changing reader behavior or tolerance in this CSS PR. Final-head required CI still gates readiness.
