# Public startup: defer authenticated admin routes

Public visitors previously waited for the admin route graph to be imported before
the server could listen. The admin mount now authenticates first, then imports
its unchanged routes on the first authenticated request. Concurrent first
requests share that load; subsequent requests use the loaded router. Public
routes, database readiness, worker startup and stream-token authentication remain
unchanged. No Cloud Run capacity or billing configuration changed.

## Evidence

Base: `e9523f7eba8ef5ab43dbc8d6d8e152758af329c1`. The live backend inspected on
September 22 was `2305ee8b8736bd8cce4047c37e7a470978ab5284`.

A bounded recent-log sample contained 27 startup events with bootstrap-to-listen
times of 1,263–3,746 ms (median 1,655 ms). A separate last-30 readiness sample
showed bootstrap-to-first-ready at 1,763–5,109 ms (median 2,187 ms), while the
readiness database query took 2–33 ms (median 3 ms). These are operational samples,
not population percentiles or a new browser/request-ID cold-start correlation.

Local paired profiling used Node 20.20.1, macOS arm64, compiled production code,
fresh processes, alternating variant order, one excluded warmup pair and eight
measured pairs. Only the compiled admin entry was swapped between the original
eager entry and the new authenticated lazy entry. The existing
`scripts/profile-startup-imports.mjs` disables networking and listen callbacks.
This isolates import/registration cost; it does not measure Cloud Run startup,
database readiness, container scheduling or user-visible page latency.

| Metric, median | Eager baseline | Lazy admin |
| --- | ---: | ---: |
| Import to listen | 296.61 ms | 247.79 ms |
| CPU work | 529.05 ms | 471.36 ms |

Import-to-listen observations in pair order, milliseconds:

- Baseline: 299.8, 317.5, 288.2, 297.9, 282.6, 291.1, 295.3, 306.1.
- Candidate: 257.9, 243.2, 252.8, 259.8, 244.6, 237.6, 250.9, 243.0.

The local median reduction is about 49 ms / 16% for this startup phase, and 11%
for CPU work. It is **not a 16% page-loading claim**. The likely visitor benefit
is a smaller component of the occasional wait when Cloud Run starts an instance;
an already-running instance does not gain this startup saving.

## Tradeoffs and validation

The first authenticated admin request on each instance pays the deferred import
cost. An import failure now fails that admin request rather than preventing
public startup. Express receives the error; the generic loader permits another
attempt, although Node can cache a failed module evaluation. A broken deployment
still needs correction. Readiness continues to validate the public service and
database; it does not promise the optional admin graph has been initialized.

Regression tests cover authentication before import, authentication on later
requests, concurrent load sharing, request body/path preservation, independent
public reads during loading, load failures and route fallthrough. The complete
backend suite passed: 1,400 tests, 73 skipped; production TypeScript build passed.
Existing admin endpoint tests cover the unchanged route implementations.

After an authorized deployment, compare natural starts using existing startup
logs and correlate slow public request IDs with instance starts. Compare the same
region/configuration and report the startup phase separately from total request
latency. Also exercise the first authenticated admin read. Do not force traffic,
enable paid always-warm instances, or weaken the database readiness check to
manufacture a better number.

This follows Google's guidance to defer initialization of infrequently used
objects, including its explicit first-request latency tradeoff:
[Cloud Run development tips](https://docs.cloud.google.com/run/docs/tips/general#perform_lazy_initialization_of_global_variables).

Related: [startup investigation #130](https://github.com/MLGalusha/letter-archive/issues/130).
That issue remains open until production tail-latency acceptance is met.
