// next14-middleware — Next 14 defaults to the edge runtime for
// `middleware.ts`. The adapter is documented as Node-runtime only, so
// the config export opts into `nodejs` explicitly. That's the supported
// pattern in Next 14 (`experimental.nodeMiddleware` is not needed at 14
// when declared on the config export).

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
