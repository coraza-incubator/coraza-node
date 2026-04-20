# Performance notes

All numbers in this document come from a single machine: **AMD Ryzen 7 7800X3D
(16 logical cores), 64 GB RAM, Linux (WSL2), Node 25.8, Docker 28.4**. Your
numbers will vary; the *ratios* should hold.

Benchmark harness: `bench/k6/mixed.js` — 9-route weighted mix (root, search,
echo, upload, image, user, + SQLi/XSS attacks), 50 VUs, 20 s duration.
Attacks comprise ~5% of the traffic. Express adapter, POOL=8 unless noted.

## Headline numbers

| Config | RPS | p95 (ms) | p99 (ms) | Boot (ms) | Binary size |
|---|---:|---:|---:|---:|---:|
| WAF off (baseline) | 11,601 | 4.0 | 5.4 | n/a | n/a |
| WAF on, **single WAF**, TinyGo + full CRS | 1,061 | 48.3 | 61.9 | ~170 | 3.5 MB |
| WAF on, **POOL=4**, TinyGo + full CRS | 3,373 | 23.7 | 36.2 | ~170 | 3.5 MB |
| WAF on, **POOL=8**, TinyGo + full CRS | **4,616** | 28.0 | 43.9 | ~170 | 3.5 MB |
| WAF on, POOL=16, TinyGo + full CRS | 4,900 | 47.6 | 81.5 | ~170 | 3.5 MB |
| WAF on, POOL=8, minimal WASI shim | 4,542 | 28.7 | 44.7 | ~180 | 3.5 MB |
| WAF on, POOL=8, **std Go wasip1 + wasilibs** | 953 | 170.9 | 318.5 | ~39,000 | 27 MB |

**Takeaway**: the TinyGo build at POOL=8 is the current best. Beyond that,
rule tuning (see below) is the next lever.

## What was tried and rejected

### Standard Go `GOOS=wasip1` + `coraza-wasilibs`

**Hypothesis**: wasilibs' Ragel-based regex engine is 3-9× faster than Go
stdlib regex on CRS body rules (confirmed on native Go microbench). TinyGo
can't link wasilibs (wazero internals trigger a linker segfault), but
standard Go 1.24+ with `-buildmode=c-shared` and `//go:wasmexport` can.

**Result**: **failure, 5× slower than TinyGo.**

| metric | TinyGo | std Go + wasilibs |
|---|---:|---:|
| RPS @ POOL=8 | 4,616 | 953 |
| p99 (ms) | 43.9 | 318.5 |
| Boot (ms) | 170 | 39,000 |
| Binary | 3.5 MB | 27 MB |

**Why**: Standard Go's WASM runtime includes the full Go GC, scheduler,
reflection, and stdlib. V8 compiles the bigger module worse, every
allocation goes through the richer heap, and first-request compilation of
regex JIT data structures happens at boot (39 s cold start). The regex
speed win gets more than erased by the runtime overhead.

**Verdict**: do not try again unless the Go team ships a stripped-down
WASM runtime or TinyGo's linker learns to handle wazero. Branch
`exp/go-wasi` contains the failed attempt as a reference.

### `coraza-wasilibs` linked into the TinyGo build

**Hypothesis**: If wasilibs links under TinyGo, we'd get both the small
TinyGo runtime AND the faster regex.

**Result**: **linker segfault.** TinyGo 0.34's linker can't resolve
wazero's internal symbols. Reproducible with `-tags=wasilibs`.

**Why**: wazero uses Go features (including complex interface method
resolution and reflection paths) that TinyGo's compiler emits in a form
wasm-ld can't link in the WASI target configuration.

**Verdict**: use wasilibs only for native Go benchmarks. Track
[tinygo-org/tinygo#4186](https://github.com/tinygo-org/tinygo/issues/4186)
and similar for linker progress.

### libcoraza (C-FFI)

**Hypothesis**: libcoraza is a mature C wrapper; if compiled to WASM it
might sidestep cgo-less wasip1 via `wasmexport`.

**Result**: **not viable.** libcoraza uses cgo (`import "C"`) to bridge
Go ↔ C. Standard Go's wasip1 target has NO cgo support (tracking:
[golang/go#55351](https://github.com/golang/go/issues/55351)). Even if
cgo worked on wasip1, libcoraza wraps the SAME Coraza Go code — you'd
get the identical regex engine plus C-ABI marshaling overhead on every
call (3-5× per HTTP transaction).

Full writeup: [`docs/libcoraza-feasibility.md`](./libcoraza-feasibility.md).
Branch `exp/libcoraza` has a doc commit.

**Verdict**: do not try. Any existing Coraza-WASM project (proxy-wasm,
http-wasm, Traefik plugin) bypasses libcoraza and imports Coraza's Go
package directly — same as we do.

### Node built-in `WASI` vs a minimal inline shim

**Hypothesis**: Node's `node:wasi` goes through a C++ binding; a pure-JS
shim might be faster on the hot path.

**Result**: **noise-level equal.** 4,616 vs 4,542 RPS — within run-to-run
variance.

**Why**: The WASM module doesn't actually call WASI imports often during
a request. Most are stubbed (`no_fs_access` tag). The only hot imports
are `clock_time_get` and `random_get`, plus occasional `fd_write`. The
boundary cost isn't the bottleneck.

**Verdict**: kept the shim as `CORAZA_WASI=minimal` — drops a ~2 MB
native dependency and helps Deno/Bun portability. Not a perf win.

### Alternative WASM runtimes (Wasmer, Wasmtime)

Didn't benchmark — the analysis above suggests runtime choice won't
move the needle when the bottleneck is Go-compiled regex inside the WASM.
V8's WASM engine (Liftoff + TurboFan) is competitive with Cranelift
(Wasmtime) and SinglePass (Wasmer) on this workload class. If anyone
actually benchmarks, please PR the numbers.

## What actually moves the needle

Three things, roughly in order:

1. **WAFPool** (`createWAFPool({ size })` + `coraza({ waf: pool })`) —
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

## What next

If you want to push past 4,616 RPS at full CRS:

- **Host-regex experiment** — forward `@rx` to V8's `RegExp` via a WASM
  host import. V8 Irregexp is JIT-compiled; avoids running Go regex
  inside the WASM entirely. Tracked in branch `exp/host-regex`.
- **CRS tuning** — find the knee of the category-exclusion curve.
  Tracked in `exp/crs-tune`.
- **Per-pattern compile cache** — CRS compiles ~1,300 regex patterns at
  boot. Memoizing already happens in Coraza; main cost is first-request
  warmup.
