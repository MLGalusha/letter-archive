# Public image performance loop

The current benchmark measures sustained archive scrolling, not just initial LCP.
See [the experiment log](../docs/image-loading/experiment-log.md) for methodology,
acceptance rules and before/after evidence.

From the repository root (existing e2e dependencies and Chromium required):

```sh
node e2e/scripts/image-scroll-benchmark.mjs --label baseline --runs 2
node e2e/scripts/image-scroll-benchmark.mjs --label baseline-4g --network 4g --step-ms 400 --runs 2
```

Or use `npm run benchmark:images -- --label baseline --runs 2` in `e2e/`.
Runs are serial and bounded to 1–5 repetitions. No production data writes or cache-busting.
The default target is the production homepage and Collection 009. `--paths /collections/007`
selects the small-collection case. `--viewports mobile` selects a single viewport.

To compare a candidate without deploying it, build the frontend with
`VITE_API_URL=https://api.voicesthatremain.com` and an absolute output directory,
then pass `--assets /absolute/build/path`. Compare against an identically served
control build. This substitutes frontend assets only; image/API traffic and browser
caching remain real. Never compare this mode's initial HTML/JS loading against an
unsubstituted production navigation.

1. Capture the deployed revision and a repeatable baseline.
2. Form one hypothesis; preserve image quality, layout and publication policy.
3. Make a focused change on an isolated branch.
4. Rerun the identical scenario; inspect tail waits, unresolved images, bytes and requests.
5. Repeat in reverse order to detect warm-cache effects. Keep resource improvements
   only when browser behavior and required tests remain correct.
6. Commit and push; resolve CI/review findings, merge green, and verify deployment.
7. Repeat production measurements and publish a report with raw evidence and limits.

Avoid hard resets to revert experiments. Never touch the separate dirty handwriting
checkout. Inspect Google Cloud read-only; discuss any cloud configuration or billing
changes with the owner before acting.

The older `e2e/tests/image-benchmark.spec.ts` remains an initial-load benchmark.
Its LCP-only metric is insufficient for accepting scrolling improvements.
