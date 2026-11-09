# Msgpack boundary drag performance

Goal: improve the existing continuous surface drag without reducing fitting accuracy or changing exported labels.

Approved direction: frame-coalesced pointer updates and local surface fitting; release still commits the exact final boundary.

Alternatives: reducing sampling sacrifices accuracy; moving fitting to a worker adds serialization and lifecycle complexity. Reuse exact unchanged segments first.

Work in the current checkout to preserve the user's existing uncommitted implementation; no commits or unrelated cleanup.

- [x] Add regression tests for event coalescing, final release, cancellation/disposal, stable geometry buffers and cached fitting equivalence.
- [x] Flush queued drag positions from the existing render loop, with a final synchronous flush on release and discard on cancellation.
- [x] Cache exact unchanged sample projections and surface segments per boundary; publish caches only after a successful fit. Keep only the previous fit.
- [x] Reuse line geometry when its point count is unchanged.
- [x] Run focused tests, msgpack type checking and browser editing regressions; review the resulting changes.

Verification: Playwright Chromium unit specs and editing page specs, plus vue-tsc with tsconfig.msgpack-check.json. Compare cached paths to uncached paths and measure actual surface-query counts, without timing-sensitive assertions.

Results: 55 core tests and 5 browser regressions passed; scoped vue-tsc and formatting checks passed. Cache equivalence covers planar and folded surfaces, disconnected-route rejection and recovery. A test model's local drag uses fewer than half the original surface queries; unchanged controls use none. Ten queued move events produce one frame update. Independent review found no actionable issues.

Browser validation required the existing Chromium installation and a local server outside the sandbox. Parallel browser runs showed a download timeout and a screenshot mismatch; the editing suite and then the complete five-test browser suite passed sequentially (one worker). No real large-model FPS measurement was made.
