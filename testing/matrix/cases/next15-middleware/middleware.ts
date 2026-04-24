// next15-middleware — Next 15 defaults the middleware to the Node runtime
// with webpack. We still pin `runtime: 'nodejs'` on the config export
// because the compatibility matrix is meant to catch regressions that
// happen when users follow the documented quick-start verbatim.

import path from 'node:path'
import { createWAF, createWAFPool } from '@coraza/core'
import { recommended } from '@coraza/coreruleset'
import { coraza } from '@coraza/next'

const usePool = process.env.POOL === '1'
const poolSize = Number(process.env.POOL_SIZE ?? 2)

// Next bundles `middleware.ts`; `import.meta.url` points at a synthetic
// protocol inside the bundler output. Resolve the wasm binary from the
// concrete workspace location so the bundler doesn't have to understand
// the core package's loader.
const wasmPath = path.resolve(
  process.cwd(),
  '../../../../packages/core/src/wasm/coraza.wasm',
)

const wafPromise = usePool
  ? createWAFPool({
      rules: recommended(),
      mode: 'block',
      size: poolSize,
      wasmSource: wasmPath,
    })
  : createWAF({
      rules: recommended(),
      mode: 'block',
      wasmSource: wasmPath,
    })

export const middleware = coraza({ waf: wafPromise })
export const config = {
  matcher: '/:path*',
  runtime: 'nodejs',
}
