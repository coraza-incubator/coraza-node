import { describe, it, expect } from 'vitest'
import { createHostRegex, translatePattern } from '../src/hostRegex.js'

describe('translatePattern', () => {
  it('passes through a bare pattern unchanged', () => {
    expect(translatePattern('abc')).toEqual({ source: 'abc', flags: '', ok: true })
  })

  it('maps the (?sm) inline flag prefix to JS flags', () => {
    const r = translatePattern('(?sm)^foo.bar$')
    expect(r.ok).toBe(true)
    expect(r.source).toBe('^foo.bar$')
    expect(r.flags.split('').sort().join('')).toBe('ms')
  })

  it('rejects the PCRE-only x flag', () => {
    expect(translatePattern('(?x)foo # comment').ok).toBe(false)
  })

  it('rejects any unknown flag letter', () => {
    expect(translatePattern('(?z)foo').ok).toBe(false)
  })

  it('dedupes repeated flag letters', () => {
    const r = translatePattern('(?iii)foo')
    expect(r.ok).toBe(true)
    expect(r.flags).toBe('i')
  })
})

describe('createHostRegex', () => {
  it('compiles, matches, and reflects size()', () => {
    const hr = createHostRegex()
    const h = hr.compile('foo.*bar')
    expect(h).toBeGreaterThan(0)
    expect(hr.size()).toBe(1)
    expect(hr.match(h, 'foo123bar')).toBe(true)
    expect(hr.match(h, 'no match here')).toBe(false)
  })

  it('compile returns 0 on PCRE syntax JS cannot parse (atomic groups)', () => {
    const hr = createHostRegex()
    const h = hr.compile('(?>foo)bar')
    expect(h).toBe(0)
    expect(hr.rejected()).toBe(1)
  })

  it('rejects the `x` flag at the translator layer', () => {
    const hr = createHostRegex()
    const h = hr.compile('(?x)foo  #c')
    expect(h).toBe(0)
    expect(hr.rejected()).toBe(1)
  })

  it('match on unknown handle returns false (does not throw)', () => {
    const hr = createHostRegex()
    expect(hr.match(999, 'anything')).toBe(false)
  })

  it('free removes a pattern so later matches miss', () => {
    const hr = createHostRegex()
    const h = hr.compile('abc')
    expect(hr.match(h, 'abc')).toBe(true)
    hr.free(h)
    expect(hr.match(h, 'abc')).toBe(false)
    expect(hr.size()).toBe(0)
  })

  it('memoizes repeated (handle,input) and does not re-test the RegExp', () => {
    const hr = createHostRegex()
    const h = hr.compile('foo.*bar')
    const spy: number[] = []
    const origTest = RegExp.prototype.test
    RegExp.prototype.test = function (this: RegExp, s: string): boolean {
      spy.push(1)
      return origTest.call(this, s)
    }
    try {
      const a = hr.match(h, 'foo-xx-bar')
      const b = hr.match(h, 'foo-xx-bar')
      const c = hr.match(h, 'foo-xx-bar')
      expect(a).toBe(true)
      expect(b).toBe(true)
      expect(c).toBe(true)
      expect(spy.length).toBe(1)
    } finally {
      RegExp.prototype.test = origTest
    }
  })

  it('memo keeps distinct entries and evicts beyond capacity', () => {
    const hr = createHostRegex()
    const h = hr.compile('x')
    const origTest = RegExp.prototype.test
    let calls = 0
    RegExp.prototype.test = function (this: RegExp, s: string): boolean {
      calls++
      return origTest.call(this, s)
    }
    try {
      for (let i = 0; i < 8; i++) hr.match(h, `a${i}`)
      expect(calls).toBe(8)
      // Repeat the same 8 inputs — all memo hits, no new test() calls.
      for (let i = 0; i < 8; i++) hr.match(h, `a${i}`)
      expect(calls).toBe(8)
      // One new distinct input evicts the LRU tail, so a repeat of `a0`
      // (the oldest, now evicted) re-tests.
      hr.match(h, 'new-input')
      expect(calls).toBe(9)
      hr.match(h, 'a0')
      expect(calls).toBe(10)
    } finally {
      RegExp.prototype.test = origTest
    }
  })

  it('memo is cleared on free', () => {
    const hr = createHostRegex()
    const h = hr.compile('x')
    hr.match(h, 'x')
    hr.free(h)
    // Recompile at a new handle — the old memo must not leak.
    const h2 = hr.compile('yyy')
    expect(hr.match(h2, 'x')).toBe(false)
  })

  it('returns consistent results across repeated calls on both match and no-match', () => {
    const hr = createHostRegex()
    const h = hr.compile('^admin$')
    expect(hr.match(h, 'admin')).toBe(true)
    expect(hr.match(h, 'admin')).toBe(true)
    expect(hr.match(h, 'user')).toBe(false)
    expect(hr.match(h, 'user')).toBe(false)
  })
})
