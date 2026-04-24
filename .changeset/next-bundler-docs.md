---
'@coraza/next': patch
---

Documentation: rewrite the README version/runtime/WASM-loader table to
accurately describe Next 14 / 15 / 16. Add a "Known bundler quirks"
section pointing at the `@coraza/core` `createRequire` fallback that
makes Next 15 middleware work without a manual `wasmSource` override.
Link the `examples/next15-app` and `examples/next16-app` demos. No
runtime API change.
