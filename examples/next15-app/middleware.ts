import { createWAF } from '@coraza/core'
import { recommended } from '@coraza/coreruleset'
import { coraza } from '@coraza/next'

const wafDisabled = process.env.WAF === 'off'
const ftw = process.env.FTW === '1'

// Next 15's middleware bundler rewrites `import.meta.url` to an empty /
// sentinel string even when `runtime: 'nodejs'` is set. Without a
// fallback, @coraza/core's default WASM URL construction would throw
// `unsupported URL protocol:` at boot. The fallback inside
// `@coraza/core/src/wasmResolve.ts` resolves the shipped coraza.wasm via
// `createRequire(import.meta.url).resolve('@coraza/core/package.json')`,
// which Node's own resolver handles regardless of what the bundler did to
// import.meta.url. That means this middleware.ts needs zero manual path
// plumbing — just `createWAF` and go.
const wafPromise = wafDisabled
  ? null
  : createWAF({
      rules: recommended(ftw ? { paranoia: 2 } : {}),
      mode: ftw ? 'block' : ((process.env.MODE ?? 'block') as 'detect' | 'block'),
    })

export const middleware = wafPromise
  ? coraza({ waf: wafPromise })
  : async () => undefined as unknown as Response

export const config = {
  matcher: '/:path*',
  runtime: 'nodejs',
}
