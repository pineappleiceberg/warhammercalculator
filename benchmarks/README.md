# Large-volley benchmarks

`benchmark_volley.c` exercises two deterministic exact-distribution workloads:

- 80 attacks with multi-model damage allocation and Feel No Pain
- the maximum 32 ordered weapons against the maximum 16 mixed target segments

Enable the benchmark target in a native or Emscripten build with
`-DWHC_BUILD_BENCHMARKS=ON`. The executable accepts an iteration count followed
by a maximum allowed time per iteration and emits one JSON object. CI records
both native and WebAssembly reports as downloadable artifacts and rejects a
native iteration over 250 ms or a WebAssembly iteration over 500 ms. Those
limits intentionally leave headroom for shared runners while catching
algorithmic regressions. The executable also fails unless both scenarios retain
their pinned aggregate exact-result checksum.

The initial GNU gprof run attributed about 39% of the two-scenario runtime to
11.4 million redundant target-capacity calls and 6.5 million target-position
lookups. Reusing the already-known capacity and current-model wound remainder
reduced the instrumented 100-iteration run from 1.04 seconds to 0.65 seconds.
The mixed 32-weapon/16-target case fell from 13.59 ms to 5.84 ms per iteration
in that same instrumented build. Exact output checksums were unchanged.
