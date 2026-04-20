# coraza-node

OWASP Coraza WAF for Node.js — ships as an npm package, no sidecar required.

The WAF engine ([OWASP Coraza](https://github.com/corazawaf/coraza)) is compiled
to WebAssembly via TinyGo and embedded inside each framework adapter. The
[OWASP CoreRuleSet](https://github.com/coreruleset/coreruleset) is baked into
the WASM via [`coraza-coreruleset`](https://github.com/corazawaf/coraza-coreruleset).

## Packages

| Package | Description |
| --- | --- |
| [`@coraza/core`](./packages/core) | WAF engine (loads the WASM). Framework-agnostic. |
| [`@coraza/coreruleset`](./packages/coreruleset) | CRS config helpers & presets. |
| [`@coraza/express`](./packages/express) | Express middleware. |
| [`@coraza/fastify`](./packages/fastify) | Fastify plugin. |
| [`@coraza/next`](./packages/next) | Next.js middleware adapter. |
| [`@coraza/nestjs`](./packages/nestjs) | NestJS module + guard. |

## Quick start — Express

```ts
import express from 'express'
import { coraza } from '@coraza/express'
import { recommended } from '@coraza/coreruleset'

const app = express()
app.use(await coraza({ rules: recommended() }))
```

## Development

```sh
pnpm install
pnpm build         # builds WASM + all packages
pnpm test          # unit tests, coverage enforced
pnpm e2e           # end-to-end tests per adapter
```

## Performance notes

Full numbers live in [`docs/performance.md`](./docs/performance.md). Summary
of what was tried, measured, and kept:

| Approach | Status | Why |
| --- | --- | --- |
| TinyGo + nottinygc + custom stack size (current) | **kept** | Smallest binary, best boot (170 ms), acceptable throughput |
| WAFPool (N worker_threads) | **kept, first-class** | 4.3× recovery: 4,616 RPS at POOL=8 vs 1,061 single-WAF |
| Memory-section patch (137 MiB min) | **kept** | Required — CRS regex compilation OOBs otherwise |
| Minimal WASI shim (opt-in via `CORAZA_WASI=minimal`) | kept | DX win (no native dep); perf is noise-level equal |
| Rule-class exclusions via `excludeCategories` | kept | Easy user-side knob for faster configs |
| Standard Go `wasip1` + wasilibs | **abandoned** | 953 RPS (5× *slower* than TinyGo baseline), 39 s boot |
| `coraza-wasilibs` inside TinyGo build | **abandoned** | TinyGo linker segfaults on wazero internals |
| libcoraza (C-FFI) compiled to WASM | **abandoned** | Doesn't exist; wasip1 has no cgo; would add marshaling overhead on same Go code anyway (see [docs/libcoraza-feasibility.md](./docs/libcoraza-feasibility.md)) |

**Don't retry the abandoned paths unless upstream Go / TinyGo / wasilibs
land something new.** The underlying issue each time is that wasip1 can't
cross the cgo boundary and standard Go's WASM runtime overhead dominates
whatever regex-engine wins you get.

## License

Apache-2.0
