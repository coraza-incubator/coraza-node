---
'@coraza/core': minor
---

perf(core): tighten `env.rx_match` host import for V8 fast-call

- `wasm.ts` caches a live-bound `Buffer` over the WASM linear memory,
  invalidated when `memory.buffer` identity changes (WASM
  `memory.grow`). `rx_match` now decodes via
  `buf.toString('utf8', start, end)` — a direct C++ path — instead of
  rebuilding a `Uint8Array` view and round-tripping through
  `TextDecoder.decode(subarray(...))` on every call.
- `hostRegex.ts` adds a per-handle move-to-front LRU of size 8 over
  `(handle, input) -> matched`. CRS paranoia-2 fires a cascade of
  `@rx` rules against the same ARGS value; the LRU collapses repeated
  evaluations of the same pair to a single regex test.

Observable behaviour is unchanged: same boolean return, same
`host_regex` capture semantics, same fail-closed on compile error
(Go falls back to stdlib regex for PCRE-only features).
