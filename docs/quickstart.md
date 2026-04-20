# Quickstart — Express in 30 lines

This is the realistic shape of integrating coraza-node into an Express app.
Three packages, one adapter call, secure-by-default. Skip to the
[multi-core pool version](#multi-core-pool) further down if you care
about throughput.

## Minimum viable (single WAF)

```ts
// server.ts
import express from 'express'
import { createWAF } from '@coraza/core'
import { recommended } from '@coraza/coreruleset'
import { coraza } from '@coraza/express'

const app = express()
app.use(express.json())

// 1. Create the WAF once at process start.
//    `recommended()` loads the full OWASP CoreRuleSet with sensible
//    defaults for Node.js apps (php/java/dotnet rules excluded).
const waf = await createWAF({
  rules: recommended(),
  mode: 'block', // 'detect' for dry-run / tuning mode
})

// 2. Mount the middleware. It inspects phases 1+2 in one WASM call;
//    a request that matches CRS is blocked before reaching your route.
//    `onWAFError: 'block'` is the default — any WAF crash returns 503
//    rather than silently bypassing. See docs/security.md.
app.use(coraza({ waf }))

// 3. Your app. Nothing special.
app.get('/', (_req, res) => res.json({ ok: true }))
app.post('/echo', (req, res) => res.json(req.body))

app.listen(3000)
```

That's it. Try it:

```sh
# Benign → 200
curl http://localhost:3000/

# SQLi in query → 403 blocked by CRS
curl "http://localhost:3000/?q=%27+OR+1%3D1--"

# XSS in body → 403 blocked
curl -X POST -H content-type:application/json \
  -d '{"msg":"<script>alert(1)</script>"}' \
  http://localhost:3000/echo
```

## Multi-core pool

Single-WAF tops out around 1k RPS with full CRS because the WASM is
single-threaded. Swap `createWAF` for `createWAFPool` — same adapter
API, each request dispatches to a worker thread:

```ts
import os from 'node:os'
import express from 'express'
import { createWAFPool } from '@coraza/core'
import { recommended } from '@coraza/coreruleset'
import { coraza } from '@coraza/express'

const app = express()
app.use(express.json())

const waf = await createWAFPool({
  rules: recommended(),
  mode: 'block',
  size: os.availableParallelism(), // one WAF per CPU core
})

app.use(coraza({ waf }))
// ... routes as before

app.listen(3000)
```

On a typical 8-core box this hits ~4,800 RPS with full CRS — 4.5× the
single-WAF number. See `docs/performance.md` for the full breakdown.

## Tuning for your app

Everything below is optional; the quickstart above is production-shaped
on its own.

### Trim the ruleset

CRS has ~1,300 rules. Most apps don't need all of them:

```ts
const waf = await createWAFPool({
  rules: recommended({
    paranoia: 1, // 1-4, higher = stricter + more false positives
    excludeCategories: [
      'scanner-detection', // noisy, doesn't block anything
      'dos-protection',    // rate limits — do this upstream (nginx, LB)
      'outbound-data-leak', // response-side, only matters with inspectResponse
    ],
  }),
  mode: 'block',
  size: os.availableParallelism(),
})
```

### Static asset bypass (default-on)

Request paths matching `/_next/static/*`, `/public/*`, or ending in
`.png`, `.css`, `.js`, `.woff`, etc. skip the WAF automatically. Add
your own:

```ts
app.use(coraza({
  waf,
  skip: {
    prefixes: ['/health', '/metrics'],           // internal paths
    extensions: ['pdf', 'csv'],                   // static downloads
    custom: (path) => path.startsWith('/public/') // your own logic
  },
}))
```

Disable bypass entirely with `skip: false`.

### Custom block response

Default is `403 text/plain`. Override:

```ts
app.use(coraza({
  waf,
  onBlock(interruption, req, res) {
    res.status(interruption.status || 403).json({
      error: 'blocked',
      ruleId: interruption.ruleId,
      traceId: req.headers['x-trace-id'],
    })
  },
}))
```

### Availability vs. security

By default, if the WAF itself errors (OOM, WASM trap, worker crash) we
return 503 — a request we can't evaluate doesn't reach your handler.
If you'd rather degrade gracefully and log the error:

```ts
app.use(coraza({
  waf,
  onWAFError: 'allow', // fail-open; DO NOT use lightly — see docs/security.md
}))
```

### Detect-only mode

During rollout, run in `mode: 'detect'`. Rules still fire but nothing
blocks — logs tell you what WOULD have been blocked. Flip to `'block'`
once false-positive rate is acceptable.

```ts
const waf = await createWAFPool({
  rules: recommended(),
  mode: 'detect', // log-only
  size: os.availableParallelism(),
})
```

## Operational notes

- **Startup cost**: ~170 ms per worker for WASM compile + CRS parse.
  Pool init is parallel, so 8 workers takes ~200 ms wall clock, not
  1.4 s. Prewarm happens automatically at pool creation.
- **Memory**: ~140 MB per WAF instance (CRS's rule tables live in WASM
  linear memory). 8-worker pool uses ~1.1 GB RSS. Budget accordingly.
- **Logging**: set `logger: yourPinoInstance` on `createWAFPool` to
  pipe audit entries into your normal logging stack. On Fastify we
  default to `request.log` per-request.

## What's in a request

Under the hood each request runs through Coraza in one WASM call:

```
processRequestBundle({
  method, url, protocol, headers,
  remoteAddr, remotePort, serverPort,
}, body)
→ phase 1 (headers) → phase 2 (body + anomaly score evaluation)
→ returns 0 (pass) | 1 (blocked) | throws (fail-closed)
```

See `docs/security.md` for why the atomic bundle matters — it
guarantees phase 2 runs even on body-less requests, which is where
CRS's anomaly-score evaluator fires.
