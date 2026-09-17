# Natural journal image space (#136)

This slice completes space reservation for images with known dimensions, stacked on the responsive rendition work in PR 145. Each post stores one nullable/default-empty `imageDimensions` map keyed by the exact Markdown/hero source URL. Axes must be positive integers at most 100,000; maps and explicit-save resolution are capped at 64 sources. Unknown images retain natural rendering without an invented ratio.

## Data flow and limits

- Upload responses include EXIF-oriented axes and one animation frame's dimensions. Original files are unchanged. Existing letter metadata may contain unrotated axes, so the editor captures actual displayed dimensions from its existing image-load event; explicit Save also verifies the owned original. Selecting a letter image remains immediate.
- Editor create/update, autosave and reload carry dimensions. Save and Publish parse Markdown image nodes (including reference definitions and float titles), prune stale exact-source entries, and resolve owned sources sequentially through bounded local metadata reads. No external URL is fetched by the server. Public reads never probe image files or add image-metadata requests.
- Legacy owned posts gain dimensions on explicit Save/Publish; there is no production backfill. Missing, unsupported or oversized originals return unresolved sources and keep natural unknown geometry. Paths must remain within storage even after symlink resolution. External images can supply dimensions from the author's URL preview/editor image load; the hero URL field inspects the image in the author's browser on blur with an 8-second limit. Mutable external URLs can invalidate previously observed dimensions; replace/version the URL and save again when their content changes.
- The map is returned in full on article detail/admin routes. Public journal lists include only the hero's entry, avoiding all inline metadata on every card response. Images beyond 64 unique sources or URLs longer than 2048 characters keep the unknown-dimension fallback.
- Article images receive width/height attributes and retain responsive natural proportions. Float titles stay intact; known floats use source width constrained by the existing 50% CSS maximum, preventing responsive-candidate density from changing their layout. Failed images retain their known geometry using a local SVG unavailable placeholder. Unknown failures retain the existing text fallback.

Migration 0057 adds only a nullable JSONB column with a constant empty default and is registered/classified as automatic under the existing release policy. It is compatible with the preceding application revision. No production migration/content mutation was run during implementation.

## Save correctness

The new autosave regression exposed an existing error: an effect continually replaced the saved fingerprint with the current draft fingerprint, making dirty detection false. Saved and current fingerprints now have distinct ownership. Only a successful persisted snapshot advances the saved fingerprint. Edits made while saving remain dirty; failed saves remain errors. A serial promise queue prevents autosave and explicit Save/Publish snapshots from reaching the server out of order. A newly created draft's returned ID is reused by a queued save. Earlier responses do not replace newer dimension state or Markdown.

## Controlled verification

Tests cover schema/migration registration, actual rotated/animated uploads, API save/reload/null clearing, omitted metadata preservation, original bytes, legacy lookup, missing files, path ownership, external no-fetch behavior, reference Markdown, wrap titles, source replacement, failed-image reservation, editor autosave/reload/Publish, failed saves and edits/manual saves during an in-flight save.

[Browser script](evidence/journal-dimensions/layout-check.js), [Chromium results](evidence/journal-dimensions/chrome.json), [WebKit results](evidence/journal-dimensions/webkit.json): both engines at 390px and 1440px hold every fixture image response before completion. Hero, reference-style inline, float-left and failed-image boxes have nonzero reserved dimensions while held. After success or original-fallback failure, image dimensions and downstream content positions stay within 1px. Positions are relative to the hero inside the application's scroll container, excluding scroll anchoring; fonts settle before measurement. Test images are controlled SVG responses with the stored aspect ratios. Separate real Sharp/HTTP tests verify photo orientation and animation metadata; this is not a production CLS score or physical-phone result.

Reproduce against Vite on 4198 with `VITE_API_URL=http://127.0.0.1:4197`; the script stubs that API in the browser, so no backend/database is required. Run through Playwright CLI `run-code` in Chromium and WebKit. Local screenshots and earlier failed runs are not acceptance evidence; retained JSON contains the passing before/after measurements.
