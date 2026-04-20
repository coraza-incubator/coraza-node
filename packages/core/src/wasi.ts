// Minimal WASI preview-1 shim used by @coraza/core in place of node:wasi.
//
// Node's built-in WASI is general-purpose and goes through a C++ binding
// per call. For this project the WASM module only actually USES a handful
// of imports (fd_write for log lines, clock_time_get for timestamps,
// random_get for regex nondet). Everything else is stub-able with ERRNO_BADF
// because the no_fs_access build tag disables the filesystem probe in
// Coraza. Keeping the shim pure JS removes the per-call boundary cost and
// cuts a ~2 MB native dependency.
//
// The shim is API-compatible with node:wasi's `{ wasiImport }` shape —
// `instantiate()` can swap it in transparently.

import { randomFillSync } from 'node:crypto'
import type { Logger } from './types.js'

/** Subset of the WASI preview-1 ABI that Coraza compiled via TinyGo actually invokes. */
export type WasiImport = Record<string, (...args: number[]) => number | bigint>

const ERRNO_SUCCESS = 0
const ERRNO_BADF = 8
const ERRNO_INVAL = 28

const STDOUT = 1
const STDERR = 2

interface WasiContext {
  logger: Logger
  getMemory: () => WebAssembly.Memory
}

/**
 * Create a WASI preview-1 import object. Matches the shape node:wasi
 * produces under `.wasiImport`. Unimplemented ops return ERRNO_BADF so
 * Coraza's optional filesystem paths fall through cleanly.
 */
export function createMinimalWasi(ctx: WasiContext): { wasiImport: WasiImport; start: (_: unknown) => void; initialize: (_: unknown) => void } {
  const viewU8 = () => new Uint8Array(ctx.getMemory().buffer)
  const viewDV = () => new DataView(ctx.getMemory().buffer)

  const writeFd = (fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number): number => {
    if (fd !== STDOUT && fd !== STDERR) return ERRNO_BADF
    const dv = viewDV()
    const u8 = viewU8()
    let total = 0
    const parts: Uint8Array[] = []
    for (let i = 0; i < iovsLen; i++) {
      const p = iovsPtr + i * 8
      const bufPtr = dv.getUint32(p, true)
      const bufLen = dv.getUint32(p + 4, true)
      parts.push(u8.subarray(bufPtr, bufPtr + bufLen))
      total += bufLen
    }
    const joined = Buffer.concat(parts.map((p) => Buffer.from(p)))
    const text = joined.toString('utf8')
    // Forward non-empty lines to the logger; keep it quiet otherwise.
    if (text.length > 0) {
      if (fd === STDERR) ctx.logger.warn(text.replace(/\n$/, ''))
      else ctx.logger.debug(text.replace(/\n$/, ''))
    }
    dv.setUint32(nwrittenPtr, total, true)
    return ERRNO_SUCCESS
  }

  const wasiImport: WasiImport = {
    // Clocks — nanos since epoch. Return monotonic-ish for either.
    clock_time_get(_id, _precision, timestampPtr) {
      const ns = BigInt(Date.now()) * 1_000_000n
      viewDV().setBigUint64(timestampPtr as number, ns, true)
      return ERRNO_SUCCESS
    },

    // Args / env — all empty.
    args_sizes_get(argcPtr, argvBufSizePtr) {
      const dv = viewDV()
      dv.setUint32(argcPtr as number, 0, true)
      dv.setUint32(argvBufSizePtr as number, 0, true)
      return ERRNO_SUCCESS
    },
    args_get() { return ERRNO_SUCCESS },
    environ_sizes_get(countPtr, bufSizePtr) {
      const dv = viewDV()
      dv.setUint32(countPtr as number, 0, true)
      dv.setUint32(bufSizePtr as number, 0, true)
      return ERRNO_SUCCESS
    },
    environ_get() { return ERRNO_SUCCESS },

    // File descriptors — write to stdout/stderr only.
    fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) {
      return writeFd(fd as number, iovsPtr as number, iovsLen as number, nwrittenPtr as number)
    },

    // Everything else related to files is a no-op returning BADF. Coraza's
    // no_fs_access tag means these are never on the hot path.
    fd_close: () => ERRNO_BADF,
    fd_fdstat_get: () => ERRNO_BADF,
    fd_filestat_get: () => ERRNO_BADF,
    fd_prestat_get: () => ERRNO_BADF,
    fd_prestat_dir_name: () => ERRNO_BADF,
    fd_read: () => ERRNO_BADF,
    fd_readdir: () => ERRNO_BADF,
    fd_seek: () => ERRNO_BADF,
    path_filestat_get: () => ERRNO_BADF,
    path_open: () => ERRNO_BADF,

    proc_exit(code) {
      throw new Error(`coraza: WASI proc_exit(${code}) — WASM trap`)
    },

    sched_yield: () => ERRNO_SUCCESS,

    random_get(bufPtr, bufLen) {
      const u8 = viewU8()
      const buf = Buffer.from(u8.buffer, u8.byteOffset + (bufPtr as number), bufLen as number)
      randomFillSync(buf)
      return ERRNO_SUCCESS
    },
  }

  // Mirror node:wasi's lifecycle API so `instantiate.ts` can call start()
  // or initialize() regardless of which implementation it holds.
  return {
    wasiImport,
    start: (instance: unknown) => {
      const inst = instance as { exports: { _start?: () => void } }
      if (typeof inst.exports._start === 'function') inst.exports._start()
    },
    initialize: (instance: unknown) => {
      const inst = instance as { exports: { _initialize?: () => void } }
      if (typeof inst.exports._initialize === 'function') inst.exports._initialize()
    },
  }
}

/** Return true if `CORAZA_WASI=native` or unset (default). */
export function useNativeWasi(): boolean {
  const v = process.env.CORAZA_WASI
  return v !== 'minimal'
}

// ERRNO_INVAL is exported in case consumers wrap us with stricter fs ops.
export { ERRNO_INVAL }
