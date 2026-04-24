import { createWAF } from '@coraza/core'
import { recommended } from '@coraza/coreruleset'
import { coraza } from '@coraza/next'

const wafDisabled = process.env.WAF === 'off'
const ftw = process.env.FTW === '1'

// Next 16's proxy.ts pipeline preserves import.meta.url, so @coraza/core's
// default WASM resolution works without any extra plumbing. See the
// examples/next15-app/ sibling for the Next 15 case — same code, different
// filename (middleware.ts) — which used to require manually pointing at
// the WASM because Next 15 rewrites import.meta.url. That is now handled
// inside @coraza/core's defaultWasmPath() via a createRequire fallback.
const wafPromise = wafDisabled
  ? null
  : createWAF({
      rules: recommended(ftw ? { paranoia: 2 } : {}),
      mode: ftw ? 'block' : ((process.env.MODE ?? 'block') as 'detect' | 'block'),
    })

export const proxy = wafPromise
  ? coraza({ waf: wafPromise })
  : async () => undefined as unknown as Response

export const config = {
  matcher: '/:path*',
}
