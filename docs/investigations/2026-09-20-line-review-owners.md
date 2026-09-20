# Line review persistence and viewport owners

Issue: [#194](https://github.com/MLGalusha/letter-archive/issues/194). Based on main `54a71a7f2a0877a317311629359d2de7b34ab2dd`; no research alignment code copied.

## Boundaries

- `useSegmentEditor` retains draft mutations, selection and undo/redo history.
- `useSegmentPersistence` owns committed draft snapshots, revisions, save coalescing, debounce, source expectations and completion revocation. Its two operations are `flush` and `captureGuard`; the component supplies a target, immutable draft, serialization callback, and saved/error callbacks.
- `useLineReviewViewport` owns image/container measurements, fit/zoom/pan, minimap geometry and gesture/observer cleanup. It has no API, transcript or persistence dependency.
- `LineReviewMode` composes the owners and retains transcript editing, trust/mode/page decisions, and rendering. A keyed inner session changes only for letter ID, primary source revision or ordered page ID/type/checksum identity. Ordinary DTO refreshes preserve local drafts and history.

Snapshots become visible to asynchronous saves in layout effects, after commit. Every successful flush drains newer committed edits before clearing dirty state or authorizing a transition. Mapping uses this same flush; its previous direct API path is removed. Blocked mutations, source/page changes and unmount revoke results. A revoked transport is still allowed to settle before another transport starts, preventing old server writes from overtaking newer drafts. StrictMode effect replay follows the same ordering.

An undo can return the editor to a locally clean draft while an earlier request is still writing a different snapshot. That restored draft must still be sent. An untouched different target can skip its write after the old transport drains.

The viewport resets by actual page identity, measures container changes for minimap geometry, and releases minimap capture on cancel, lost capture, page change, blur and unmount. Mouse-up outside the image ends a pan. Drawing tools revoke an existing pan.

## Automated evidence

- Six new component regressions fail against the original main component: letter/revision/checksum/page replacement at the same index, blocked in-flight verification, and newer edits during mapping. The ordinary DTO-refresh control passes on both versions.
- The extracted component/owner tests cover existing save failure, mapping retry, text spacing and slow navigation cases, plus late success/failure after unmount, transport ordering across block/unblock, StrictMode replay, debounce coalescing, clean different-page drain, observer disposal, resize/minimap geometry and gesture cancellation.
- Final focused run: **68 tests passed** across the editor component, two owners and source-conflict ownership contract.
- Final full frontend suite: **187 files, 1,402 tests passed**.
- Production build (including TypeScript): passed; existing bundle-size advisory remains.
- Required `lint:ci`: passed, **93 existing diagnostics and zero file/rule increases**. Every edited/new source and test file passes direct ESLint with zero diagnostics. Baseline file unchanged.
- `git diff --check`: passed.

The existing source-string ownership test now checks delegation to the persistence owner; timing guarantees are exercised by behavior tests. Three narrowly documented editor lint exceptions remain: committed drawing-tool changes clear gesture previews, and two read-only history availability flags observe the existing explicit history-version state updates. The keyboard callback now publishes after commit, and snap calculations include their current segment-edge dependency.

## Browser evidence

Playwright CLI, Chromium, Vite `127.0.0.1:4188`, session `quality-editor`. A two-page SVG fixture intercepted all backend API traffic; no real database writes occurred.

| Interaction | Observed result |
| --- | --- |
| Desktop fit at 1280 × 720 | Image 500 × 700; no transform/minimap |
| Ctrl-wheel zoom | Scale 2.70481; minimap viewport 94.6461% × 38.0274% |
| Minimap drag toward lower right | Bounded image pan; viewport left/top 5.35393% / 61.9726% |
| Next page after zoom | Page 2; empty transform; minimap removed |
| Segment editing | Delete 3 → 2 shapes; undo restores 3; second delete and Previous page sends 2 segments with source revision 4 / checksum-2 before showing Page 1 |
| Narrow fit at 390 × 844 | Image 390 × 546 |
| Narrow wheel zoom/minimap drag | Scale 2.00676; bounded viewport 49.8315% × 77.0289%, left/top 50.1685% / 22.9711% after drag |
| Scroll then Fit Height | Image returns to 390 × 546, transform cleared, minimap removed |

Browser coverage is a local mocked desktop/narrow viewport check. Physical touch devices, production persistence and deployed behavior are not asserted. Independent review and final-head CI remain the parent task's gate; no merge or deployment is authorized by this receipt.

## PR review correction: letter-wide trust completion

[Review finding on PR #205](https://github.com/MLGalusha/letter-archive/pull/205#discussion_r4056179320) confirmed: changing pages while a letter-wide verify/unverify request was pending revoked the page persistence guard. The successful server change then failed to update the local lock state.

Two delayed-response component regressions reproduced the incorrect lock state for verify and unverify. Trust requests now use a source-session lifetime guard, independent of the selected page. Keyed source replacement, unmount and each committed mutation-block cycle still revoke that guard. Page saves and page/mode transitions retain their existing page-specific guard.

After the correction, **74 focused tests pass**, including verify/unverify navigation plus four source-replacement and block/unblock controls. Changed files pass ESLint; frontend TypeScript and `git diff --check` pass. This correction was verified at the component layer; the earlier full-suite/build/browser receipt above belongs to the initial implementation, with final-head CI still required.
