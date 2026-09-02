import { describe, expect, it } from 'vitest'
import { LEVEL, classify, commitMessage } from '../src/classify.mjs'

const breakingFinding = { id: 'api-path-removed-without-deprecation', level: LEVEL.ERR, operation: 'GET', path: '/b', text: 'api path removed without deprecation' }
const warnFinding = { id: 'request-parameter-pattern-added', level: LEVEL.WARN, operation: 'GET', path: '/a', text: 'added a pattern' }
const additionFinding = { id: 'endpoint-added', level: LEVEL.INFO, operation: 'GET', path: '/c', text: 'endpoint added' }

describe('classify', () => {
  it('returns none when the surface bytes are identical', () => {
    expect(classify({ breaking: [], changelog: [], bytesChanged: false }).bump).toBe('none')
  })

  it('returns patch when bytes moved but nothing semantic did', () => {
    // Descriptions, examples and ordering regenerate the client but cannot
    // change how it behaves, so consumers should be able to take it blind.
    const result = classify({ breaking: [], changelog: [], bytesChanged: true })
    expect(result.bump).toBe('patch')
    expect(result.reason).toMatch(/documentation-only/)
  })

  it('returns minor for additive changes', () => {
    const result = classify({ breaking: [], changelog: [additionFinding], bytesChanged: true })
    expect(result.bump).toBe('minor')
    expect(result.findings).toEqual([additionFinding])
  })

  it('returns major for breaking changes', () => {
    const result = classify({ breaking: [breakingFinding], changelog: [breakingFinding], bytesChanged: true })
    expect(result.bump).toBe('major')
  })

  it('checks breaking before the changelog, which is a superset', () => {
    // oasdiff's changelog contains the breaking findings too. Testing the
    // changelog first would report this as a minor and ship an incompatible
    // client under a compatible version number.
    const result = classify({
      breaking: [breakingFinding],
      changelog: [breakingFinding, additionFinding],
      bytesChanged: true,
    })
    expect(result.bump).toBe('major')
  })

  it('treats WARN-level findings as major by default', () => {
    expect(classify({ breaking: [warnFinding], changelog: [warnFinding], bytesChanged: true }).bump).toBe('major')
  })

  it('can be configured to treat only ERR as major, leaving WARN a minor', () => {
    const result = classify({
      breaking: [warnFinding], changelog: [warnFinding],
      bytesChanged: true, majorAtLevel: LEVEL.ERR,
    })
    expect(result.bump).toBe('minor')
  })

  it('tolerates missing finding arrays', () => {
    expect(classify({ bytesChanged: false }).bump).toBe('none')
  })
})

describe('commitMessage', () => {
  const base = { reason: 'r', findings: [], upstreamVersion: '10', api: 'Discord' }

  it('marks a major with both a bang and a BREAKING CHANGE footer', () => {
    // release-please reads the footer rather than the `!` when bumping the
    // major on a 1.x line, so a major that emits only one of the two can
    // silently release as a minor.
    const message = commitMessage({ ...base, bump: 'major' })
    expect(message.split('\n')[0]).toMatch(/^feat\(spec\)!: /)
    expect(message).toMatch(/^BREAKING CHANGE: /m)
  })

  it('uses feat without a bang for a minor', () => {
    const message = commitMessage({ ...base, bump: 'minor' })
    expect(message.split('\n')[0]).toMatch(/^feat\(spec\): /)
    expect(message).not.toMatch(/BREAKING CHANGE/)
  })

  it('uses fix for a patch so release-please bumps the patch digit', () => {
    expect(commitMessage({ ...base, bump: 'patch' }).split('\n')[0]).toMatch(/^fix\(spec\): /)
  })

  it('records the upstream spec version and lists findings', () => {
    const message = commitMessage({ ...base, bump: 'minor', findings: [additionFinding] })
    expect(message).toMatch(/Upstream spec version: 10/)
    expect(message).toMatch(/GET \/c: endpoint added/)
  })

  it('truncates a very long finding list rather than writing a huge commit', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ ...additionFinding, path: `/p${i}` }))
    const message = commitMessage({ ...base, bump: 'minor', findings: many })
    expect(message).toMatch(/and 10 more/)
  })

  it('says unversioned when upstream publishes no info.version', () => {
    expect(commitMessage({ ...base, bump: 'patch', upstreamVersion: undefined })).toMatch(/Upstream spec version: unversioned/)
  })
})
