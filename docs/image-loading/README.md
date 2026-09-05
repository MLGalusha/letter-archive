# Public image loading

The archive preview loader now uses one display-size request per card. Removing whole-result-set reader preloading also reduces small-collection traffic. Image widths, server encoding and publication cache policy are preserved.

[Experiment log and measurements](experiment-log.md) · [Repeatable loop](../../scripts/image-perf-program.md)

Each evidence directory contains a readable `summary.json`, a compressed raw `results.json.gz`, and scroll screenshots. Decompress raw evidence with Python's `gzip` module or `gzip -dc`. It includes individual card readiness samples and image request timings/bytes. All requests are anonymous public browsing.

- `baseline-native`: production before changes, ordinary local connection, two runs per viewport/page.
- `control-4g` / `single-4g`: identical preview serving, live production image API, two fast-scroll runs per viewport.
- `small-collection-control` / `small-collection-trim` / `small-collection-control-repeat`: isolate reader-sized speculative loading in Collection 007, including a reversed warm control.
- `production-before-4g`: fast-scroll baseline directly on production before deployment.

The final production comparison will be recorded after both focused fixes deploy. These artifacts are measurements from one Chromium browser on one machine; they do not establish field performance or guarantee zero delay on other connections.
