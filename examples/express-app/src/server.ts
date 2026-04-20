import express, { type Request, type Response, type NextFunction } from 'express'
import os from 'node:os'
import { createWAF, createWAFPool, type WAFPool } from '@coraza/core'
import { recommended } from '@coraza/coreruleset'
import { coraza } from '@coraza/express'
import { handlers } from '@coraza/example-shared'

const port = Number(process.env.PORT ?? 3001)
const mode = (process.env.MODE ?? 'block') as 'detect' | 'block'
const wafDisabled = process.env.WAF === 'off'
const usePool = process.env.POOL === '1'
const poolSize = Number(process.env.POOL_SIZE ?? os.availableParallelism())

const app = express()
app.use(express.json({ limit: '10mb' }))
app.use(express.raw({ type: 'application/octet-stream', limit: '10mb' }))

const encoder = new TextEncoder()

function headersOf(h: Record<string, string | string[] | undefined>): [string, string][] {
  const out: [string, string][] = []
  for (const k in h) {
    const v = h[k]
    if (v === undefined) continue
    if (Array.isArray(v)) for (const x of v) out.push([k, x])
    else out.push([k, v])
  }
  return out
}

// Minimal inline middleware that uses WAFPool instead of @coraza/express's
// sync Transaction. Used by the benchmark to measure multi-core scaling.
function poolMiddleware(pool: WAFPool) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Cheap static-file bypass matching @coraza/core's skip defaults enough
    // to keep the bench apples-to-apples.
    if (req.url.startsWith('/img/') || req.url.endsWith('.png')) return next()
    const tx = await pool.newTransaction()
    res.once('close', () => {
      void tx.processLogging().finally(() => tx.close())
    })
    try {
      if (await tx.isRuleEngineOff()) return next()
      const interrupted = await tx.processRequest({
        method: req.method,
        url: req.originalUrl || req.url,
        protocol: `HTTP/${req.httpVersion}`,
        headers: headersOf(req.headers),
        remoteAddr: req.ip ?? '',
        remotePort: req.socket.remotePort ?? 0,
        serverPort: req.socket.localPort ?? 0,
      })
      if (interrupted) {
        const it = await tx.interruption()
        if (it) {
          res.status(it.status || 403).type('text/plain').send(
            `Request blocked by Coraza (rule ${it.ruleId})\n`,
          )
          return
        }
      }
      if (await tx.isRequestBodyAccessible()) {
        const body = (req as Request & { body?: unknown }).body
        const buf =
          body instanceof Uint8Array
            ? body
            : body && typeof body === 'object' && Object.keys(body as object).length > 0
              ? encoder.encode(JSON.stringify(body))
              : typeof body === 'string'
                ? encoder.encode(body)
                : undefined
        if (buf && (await tx.processRequestBody(buf))) {
          const it = await tx.interruption()
          if (it) {
            res.status(it.status || 403).type('text/plain').send(
              `Request blocked by Coraza (rule ${it.ruleId})\n`,
            )
            return
          }
        }
      }
      next()
    } catch (err) {
      console.error('[coraza-pool] error', err)
      next()
    }
  }
}

if (!wafDisabled) {
  if (usePool) {
    const pool = await createWAFPool({ rules: recommended(), mode, size: poolSize })
    app.use(poolMiddleware(pool))
    console.log(`express listening on :${port} (waf=on mode=${mode} POOL size=${poolSize})`)
  } else {
    const waf = await createWAF({ rules: recommended(), mode })
    app.use(coraza({ waf }))
    console.log(`express listening on :${port} (waf=on mode=${mode} single WAF)`)
  }
} else {
  console.log(`express listening on :${port} (waf=off)`)
}

app.get('/', (_req, res) => res.json(handlers.root('express').body))
app.get('/healthz', (_req, res) => res.type('text/plain').send(handlers.healthz().body as string))
app.get('/search', (req, res) => res.json(handlers.search(req.query.q as string | undefined).body))
app.post('/echo', (req, res) => res.json(handlers.echo(req.body).body))
app.post('/upload', (req, res) => {
  const len = Buffer.isBuffer(req.body) ? req.body.length : JSON.stringify(req.body ?? '').length
  res.json(handlers.upload(len).body)
})
app.get('/img/logo.png', (_req, res) => {
  const r = handlers.image()
  res.type(r.contentType!).send(r.body as Buffer)
})
app.get('/api/users/:id', (req, res) => res.json(handlers.user(req.params.id!).body))

app.listen(port)
