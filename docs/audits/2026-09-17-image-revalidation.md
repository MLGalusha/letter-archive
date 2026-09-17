# Early image revalidation

Issue #121 follows the live #50 observation of an image request doing about546ms of transformation before returning304. Public preview responses deliberately require revalidation so unpublishing takes effect on the next request. This change preserves that policy and makes revalidation cheaper.

For resized images only, the server computes a weak ETag from the currently checked page/source identity, checksum, storage path, source mtime/size, effective width, negotiated format, explicit transform recipe revision and Sharp/library versions. A matching conditional request returns304 after authorization and source existence checks, before memory-cache lookup or scheduler admission. The caller's URL version hint does not choose the identity. Encoder-option changes must bump the explicit recipe revision.

The same canonical identity keys the process-local cache and can be reused by the separately scoped durable-preview work. Original-image streaming, negotiated image quality, access rules and mandatory revalidation remain unchanged. Existing browser copies with the former byte-derived ETag need one200 response to acquire the new validator; no permanent invalidation loop is expected.

## Evidence and limits

Real local HTTP integration tests verify fresh-module304 responses with zero scheduler/Sharp calls, weak/strong/list/wildcard validators, HEAD, explicit no-cache behavior, changed source/stat/width/format/library versions, deleted/unpublished sources, private cache policy and revoked admin access. This proves skipped processing for matching validators; it is not a measured production latency or cold-start improvement.

The first request without a usable validator still needs a cached variant or a transform. Persistent reusable previews (#122) and measured loading priorities (#123) remain separate. #50 stays open for real visible-image waits and physical iPhone Safari/Chrome validation.

## Manual check

Open Home or collection003, let images finish, then revisit in the same browser without disabling its cache. Images should remain correct and complete. A normal conditional request can return304; a forced no-cache reload may correctly return200. Check Safari and Chrome. Confirming zero queued/transform work requires the request-correlated backend log (`cache: not-modified`), not visual appearance alone. The release owner will verify this through ordinary read-only requests after deployment.
