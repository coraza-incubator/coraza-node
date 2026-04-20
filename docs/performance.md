# Performance notes

All numbers in this document come from a single machine: **AMD Ryzen 7 7800X3D
(16 logical cores), 64 GB RAM, Linux (WSL2), Node 25.8, Docker 28.4**. Your
numbers will vary; the *ratios* should hold.

Benchmark harness: `bench/k6/mixed.js` — 9-route weighted mix (root, search,
echo, upload, image, user, + SQLi/XSS attacks), 50 VUs, 20 s duration.
Attacks comprise ~5% of the traffic. Express adapter, POOL=8 unless noted.

## Headline numbers

POOL=8, TinyGo WASM, k6 mixed traffic (50 VUs, 20 s, ~5% attacks).

| Config | RPS | p95 (ms) | p99 (ms) | Blocked / total attacks |
|---|---:|---:|---:|---:|
| WAF off | 11,601 | 4.0 | 5.4 | — |
| Full CRS, single WAF | 1,061 | 48.3 | 61.9 | — |
| + `createWAFPool`, size=4 | 3,373 | 23.7 | 36.2 | 1,373 / 3,362 |
| + `createWAFPool`, size=8 | 4,616 | 28.0 | 43.9 | 1,776 / 4,614 |
| + host-regex (V8 Irregexp) | 4,796 | 26.2 | 38.3 | 1,886 / 4,773 |
| + rxprefilter (AST skip) | 4,788 | 25.0 | 35.1 | 1,867 / 4,715 |
| + prewarm (JIT preheat) | 4,722 | 25.5 | 35.9 | 1,940 / 4,775 |
| **+ fused `processRequestBundle`** | **4,857** | 26.2 | 37.4 | **4,943 / 4,943** |

The fused bundle packs the connection+URI+header+body phases into one
WASM call. Under `WAFPool` this saves several MessagePort round-trips
per request, and guarantees phase 2 runs even on body-less verbs so the
CRS anomaly-score evaluator (rule `949110`) always fires.

## What actually moves the needle

Three things, roughly in order:

1. **`WAFPool`** (`createWAFPool({ size })` + `coraza({ waf: pool })`) —
   one WAF per worker thread, round-robin dispatch. 4.3× on 8 cores.
2. **Rule-class exclusions** — `recommended({ excludeCategories: [...] })`
   in `@coraza/coreruleset`. Dropping `scanner-detection`, `dos-protection`,
   and outbound-* typically saves 30-50% CPU per request. Don't exclude
   attack classes (`sqli`, `xss`, `rce`, `lfi`) unless you know what
   you're doing.
3. **Aggressive `skip` patterns** — static assets (`/img`, `/_next/static`,
   etc.) already bypass by default. Add internal paths you know don't
   carry user input.

Secondary: `inspectResponse: false` (the default) skips the response
phase — saves ~15-30% on throughput. Enable only if you have
response-side rules (data-leak detection, etc.).

## How to reproduce

```sh
# Build WASM (Docker, pinned toolchain, takes ~90 s first time)
pnpm wasm

# Run the k6 bench matrix (expects k6 on PATH)
pnpm k6

# Or run a single adapter:
pnpm --filter @coraza/bench k6 -- --adapters=express --duration=20s --vus=50

# Quick autocannon sweep (no k6 needed):
pnpm bench
```
