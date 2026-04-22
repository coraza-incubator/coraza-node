---
'@coraza/next': patch
---

Docs: update the README for Next.js 16 and `src/` layout —

- Drop `runtime: 'nodejs'` from the `config` export; Next 16 rejects the
  option outright in `proxy.ts` (`The runtime config option is not
  available in Proxy files`) and it's redundant on 14/15 because Node is
  already the default.
- Show both filenames side-by-side (`proxy.ts` on Next 16, `middleware.ts`
  on 14/15) with a short note so the snippet is copy-pasteable on every
  current major.
- Add a "File location" paragraph warning that with a `src/` layout,
  the adapter file **must** live at `src/proxy.ts` / `src/middleware.ts`
  — a file at the repo root is silently ignored (Next emits no logs).
- Document the Turbopack pool-worker hazard and point at the new
  `readyTimeoutMs` fail-fast (see the `@coraza/core` changeset).
