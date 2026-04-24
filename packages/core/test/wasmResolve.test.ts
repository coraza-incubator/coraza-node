import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  defaultWasmPath,
  defaultPoolWorkerPath,
  defaultWasmPathWithMetaUrl,
  defaultPoolWorkerPathWithMetaUrl,
} from '../src/wasmResolve.js'

describe('default WASM / pool-worker resolution', () => {
  it('returns a file:// URL via import.meta.url on a normal Node runtime', () => {
    const u = defaultWasmPath()
    expect(u).toBeInstanceOf(URL)
    expect(u.protocol).toBe('file:')
  })

  it('returns a file:// URL for the pool worker via import.meta.url', () => {
    const u = defaultPoolWorkerPath()
    expect(u.protocol).toBe('file:')
  })

  // These simulate the Next.js 15 middleware bundler which rewrites
  // `import.meta.url` to an empty string / sentinel. The URL constructor
  // throws, and we need to fall back through createRequire without taking
  // the process down.
  describe.each([
    ['empty string', ''],
    ['undefined', undefined as unknown as string],
    ['colon sentinel', ':'],
    ['opaque non-file protocol', 'webpack-internal:///./foo.js'],
  ])('when import.meta.url is %s', (_name, metaUrl) => {
    it('falls back via createRequire to a usable file:// URL (wasm)', () => {
      const u = defaultWasmPathWithMetaUrl(metaUrl)
      expect(u.protocol).toBe('file:')
      // The createRequire anchor walks up from @coraza/core/package.json;
      // the resulting path should end with dist/wasm/coraza.wasm.
      expect(fileURLToPath(u)).toMatch(/dist[\/\\]wasm[\/\\]coraza\.wasm$/)
    })

    it('falls back via createRequire to a usable file:// URL (pool worker)', () => {
      const u = defaultPoolWorkerPathWithMetaUrl(metaUrl)
      expect(u.protocol).toBe('file:')
      expect(fileURLToPath(u)).toMatch(/dist[\/\\]pool-worker\.mjs$/)
    })
  })

  // We expect the resolved file to actually exist once the package is
  // built — the fallback is useless if the path is wrong.
  it('resolves a wasm path that exists on disk (after build)', () => {
    const u = defaultWasmPathWithMetaUrl('')
    const p = fileURLToPath(u)
    // Build is a prerequisite for this test; if dist/wasm/coraza.wasm is
    // missing the fallback has returned the wrong path.
    expect(existsSync(p)).toBe(true)
  })

  it('resolves a pool-worker path that exists on disk (after build)', () => {
    const u = defaultPoolWorkerPathWithMetaUrl('')
    const p = fileURLToPath(u)
    expect(existsSync(p)).toBe(true)
  })

  it('honours a usable file:// import.meta.url without falling through', () => {
    // Hand it a known-good file URL; the new-URL branch should succeed
    // and we should get a file:// URL pointing at the same dir.
    const fakeMeta = new URL('fake-module.js', import.meta.url).href
    const u = defaultWasmPathWithMetaUrl(fakeMeta)
    expect(u.protocol).toBe('file:')
    expect(fileURLToPath(u)).toMatch(/wasm[\/\\]coraza\.wasm$/)
  })

  it('treats an http(s) anchor as unusable and falls through', () => {
    // Only file:// URLs are safe to hand to createRequire, so we should
    // fall back on the cwd anchor and still resolve successfully.
    const u = defaultWasmPathWithMetaUrl('https://example.invalid/app.js')
    expect(u.protocol).toBe('file:')
    expect(fileURLToPath(u)).toMatch(/dist[\/\\]wasm[\/\\]coraza\.wasm$/)
  })
})
