---
'@coraza/core': patch
---

Default WASM loader now falls back through `createRequire` when the host
bundler rewrites `import.meta.url` to an empty or sentinel value. Fixes
`createWAF()` / `createWAFPool()` throwing `unsupported URL protocol:` at
boot under Next.js 15's middleware bundler. The same fallback applies to
the pool's `pool-worker.mjs` resolution. Behaviour is unchanged on
runtimes that expose a usable `import.meta.url` (every non-bundled Node
process, Next 16's `proxy.ts` pipeline, plain workers).
