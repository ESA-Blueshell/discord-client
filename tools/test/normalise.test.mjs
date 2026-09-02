import { describe, expect, it } from 'vitest'
import { parseAnySpec, parseJsonSpec, serialiseSpec, sortKeys } from '../src/normalise.mjs'

const minimal = { openapi: '3.1.0', info: { title: 'T', version: '1' }, paths: {} }

describe('sortKeys', () => {
  it('orders object keys and recurses through arrays', () => {
    const sorted = sortKeys({ b: 1, a: { d: 2, c: [{ f: 3, e: 4 }] } })
    expect(Object.keys(sorted)).toEqual(['a', 'b'])
    expect(Object.keys(sorted.a)).toEqual(['c', 'd'])
    expect(Object.keys(sorted.a.c[0])).toEqual(['e', 'f'])
  })

  it('leaves scalars and null alone', () => {
    expect(sortKeys(null)).toBeNull()
    expect(sortKeys(7)).toBe(7)
    expect(sortKeys('x')).toBe('x')
  })
})

describe('parseJsonSpec', () => {
  it('parses JSON with no third-party dependency', () => {
    expect(parseJsonSpec(JSON.stringify(minimal)).openapi).toBe('3.1.0')
  })

  it('rejects a spec missing both openapi and swagger keys', () => {
    expect(() => parseJsonSpec(JSON.stringify({ info: {} }))).toThrow(/neither an `openapi` nor a `swagger`/)
  })

  it('rejects a non-object document', () => {
    expect(() => parseJsonSpec('"a string"')).toThrow(/did not parse to an object/)
  })
})

describe('parseAnySpec', () => {
  it('reads JSON and YAML to the same object', async () => {
    const fromJson = await parseAnySpec(JSON.stringify(minimal))
    const fromYaml = await parseAnySpec('openapi: 3.1.0\ninfo:\n  title: T\n  version: "1"\npaths: {}\n')
    expect(fromJson).toEqual(fromYaml)
  })

  it('rejects a document that is not an OpenAPI spec at all', async () => {
    // Upstream serving an HTML error page is the failure this guards: without it
    // the pipeline would vendor the error page and classify it as a total rewrite.
    await expect(parseAnySpec('<html>503</html>')).rejects.toThrow(/not an OpenAPI spec|did not parse/)
  })
})

describe('serialiseSpec', () => {
  it('is stable regardless of input key order', () => {
    const a = serialiseSpec({ openapi: '3.1.0', info: { version: '1', title: 'T' } })
    const b = serialiseSpec({ info: { title: 'T', version: '1' }, openapi: '3.1.0' })
    expect(a).toBe(b)
  })

  it('ends with exactly one trailing newline', () => {
    const out = serialiseSpec(minimal)
    expect(out.endsWith('}\n')).toBe(true)
    expect(out.endsWith('}\n\n')).toBe(false)
  })
})
