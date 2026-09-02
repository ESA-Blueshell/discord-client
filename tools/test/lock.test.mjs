import { describe, expect, it } from 'vitest'
import { buildLock, serialiseLock, sha256 } from '../src/lock.mjs'

describe('sha256', () => {
  it('hashes deterministically', () => {
    expect(sha256('abc')).toBe(sha256('abc'))
    expect(sha256('abc')).not.toBe(sha256('abd'))
  })
})

describe('buildLock', () => {
  const args = {
    url: 'https://example.test/openapi.json',
    rawBody: '{"openapi":"3.1.0"}',
    spec: { info: { title: 'Discord HTTP API', version: '10' } },
    surfaceSha: 'deadbeef',
    fetchedAt: '2026-09-02T00:00:00.000Z',
  }

  it('records upstream provenance and the surface hash separately', () => {
    // The two hashes answer different questions: the raw hash says whether
    // upstream moved at all, the surface hash says whether anything we
    // actually expose moved. Only the second justifies a release.
    const lock = buildLock(args)
    expect(lock.upstream.url).toBe(args.url)
    expect(lock.upstream.rawSha256).toBe(sha256(args.rawBody))
    expect(lock.upstream.specVersion).toBe('10')
    expect(lock.surface.sha256).toBe('deadbeef')
    expect(lock.fetchedAt).toBe(args.fetchedAt)
  })

  it('tolerates a spec with no info block', () => {
    const lock = buildLock({ ...args, spec: {} })
    expect(lock.upstream.specVersion).toBeNull()
    expect(lock.upstream.specTitle).toBeNull()
  })
})

describe('serialiseLock', () => {
  it('writes indented JSON with a trailing newline', () => {
    const out = serialiseLock(buildLock({ url: 'u', rawBody: '', spec: {}, surfaceSha: 's', fetchedAt: 'f' }))
    expect(out.endsWith('\n')).toBe(true)
    expect(out).toContain('\n  "upstream"')
  })
})
