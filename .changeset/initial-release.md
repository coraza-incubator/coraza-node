---
'@coraza/core': minor
'@coraza/coreruleset': minor
'@coraza/express': minor
'@coraza/fastify': minor
'@coraza/next': minor
'@coraza/nestjs': minor
---

Initial public release of `coraza-node`.

OWASP Coraza WAF for Node.js, compiled to WebAssembly via TinyGo and
packaged as an npm monorepo with adapters for Express, Fastify, Next.js,
and NestJS. Ships with the OWASP CoreRuleSet embedded in the WASM
binary; `@coraza/coreruleset` exposes ergonomic profile helpers
(`recommended`, `strict`, `balanced`, `permissive`).

- `@coraza/core` — WAF + `WAFPool` (worker_threads, per-request
  pinning), `Transaction.processRequestBundle` as the single atomic
  phase-1+phase-2 entry point, host-regex (V8 Irregexp) for `@rx`,
  rxprefilter AST literal-skip, prewarm, fail-closed defaults.
- `@coraza/{express,fastify,next,nestjs}` — idiomatic middleware
  with a shared options shape: `coraza({ waf, onBlock?, skip?,
  onWAFError? })`. NestJS also takes `onBlock: (i) => HttpException`.
- Full threat model + performance numbers in `docs/security.md` and
  `docs/performance.md`.
