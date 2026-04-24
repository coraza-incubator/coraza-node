// next16-proxy-turbopack — identical to next16-proxy but boots under
// `next dev --turbo`. Turbopack's `import.meta.url` rewrite differs from
// webpack's — regressions show up here first.

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

export const proxy = coraza({ waf: wafPromise })
export const config = { matcher: '/:path*' }
