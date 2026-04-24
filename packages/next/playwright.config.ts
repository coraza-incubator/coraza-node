import { defineConfig } from '@playwright/test'

// Both Next 15 (middleware.ts) and Next 16 (proxy.ts) pipelines use the
// same scenarios.spec.ts corpus, driven through a different webServer.
// Each run picks the target via NEXT_VARIANT=15|16 (default: 16, to
// preserve historical `pnpm e2e` behaviour). The variant also controls
// the port so the two servers don't collide when running them back-to-back.

const variant = (process.env.NEXT_VARIANT === '15' ? '15' : '16') as '15' | '16'
const PORT = variant === '15' ? 3005 : 3003
const PKG = variant === '15' ? '@coraza/example-next15' : '@coraza/example-next16'

export default defineConfig({
  testDir: './test/e2e',
  timeout: 60_000, // Next cold-start is slow
  fullyParallel: false,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `PORT=${PORT} MODE=block pnpm -F ${PKG} dev`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
