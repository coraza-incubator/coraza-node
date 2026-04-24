// next15-middleware-turbopack — same file contents as next15-middleware
// but the start script is `next dev --turbo`, which exercises the
// turbopack bundler. This is where loader regressions surface earliest
// because turbopack rewrites `import.meta.url` differently from webpack.

import path from 'node:path'
import { createWAF, createWAFPool } from '@coraza/core'
import { recommended } from '@coraza/coreruleset'
import { coraza } from '@coraza/next'

const usePool = process.env.POOL === '1'
const poolSize = Number(process.env.POOL_SIZE ?? 2)

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
