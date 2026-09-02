import { describe, expect, it } from 'vitest'
import { collectSchemaRefs, filterSpec } from '../src/filter.mjs'

/** A spec with two paths, one of which is outside the surface. */
function spec(overrides = {}) {
  return {
    openapi: '3.1.0',
    info: { title: 'T', version: '1' },
    paths: {
      '/keep': {
        parameters: [{ name: 'shared', in: 'query' }],
        get: { operationId: 'getKeep', tags: ['Other'], responses: { 200: { $ref: '#/components/responses/Ok' } } },
        post: { operationId: 'postKeep', responses: { 200: { description: 'ok' } } },
      },
      '/drop': { get: { operationId: 'getDrop', responses: { 200: { description: 'ok' } } } },
    },
    components: {
      responses: { Ok: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } } } },
      schemas: {
        Envelope: { type: 'object', properties: { item: { $ref: '#/components/schemas/Item' } } },
        Item: { type: 'object', properties: { name: { type: 'string' } } },
        Unrelated: { type: 'object' },
      },
    },
    ...overrides,
  }
}

const pathSurface = { paths: { '/keep': ['get'] } }

describe('collectSchemaRefs', () => {
  it('finds schema refs at any depth and ignores non-schema refs', () => {
    const refs = collectSchemaRefs({
      a: { $ref: '#/components/schemas/One' },
      b: [{ c: { $ref: '#/components/schemas/Two' } }],
      d: { $ref: '#/components/parameters/NotASchema' },
    })
    expect([...refs].sort()).toEqual(['One', 'Two'])
  })
})

describe('filterSpec with a path surface', () => {
  it('keeps only allow-listed methods and drops other paths', () => {
    const out = filterSpec(spec(), pathSurface)
    expect(Object.keys(out.paths)).toEqual(['/keep'])
    expect(Object.keys(out.paths['/keep']).sort()).toEqual(['get', 'parameters'])
  })

  it('keeps path-level siblings such as shared parameters', () => {
    const out = filterSpec(spec(), pathSurface)
    expect(out.paths['/keep'].parameters).toEqual([{ name: 'shared', in: 'query' }])
  })

  it('prunes schemas that nothing reachable references', () => {
    const out = filterSpec(spec(), pathSurface)
    expect(Object.keys(out.components.schemas).sort()).toEqual(['Envelope', 'Item'])
  })

  it('keeps schemas reachable only through a non-schema component section', () => {
    // Regression: seeding reachability from paths alone dropped `Envelope`,
    // which is referenced from components.responses, and produced a spec
    // oasdiff refused to load ("map key not found").
    const out = filterSpec(spec(), pathSurface)
    expect(out.components.schemas).toHaveProperty('Envelope')
    expect(out.components.schemas).toHaveProperty('Item')
  })

  it('stamps the configured tag onto surviving operations', () => {
    const out = filterSpec(spec(), { ...pathSurface, tag: 'Discord' })
    expect(out.paths['/keep'].get.tags).toEqual(['Discord'])
  })

  it('does not mutate the input spec', () => {
    const input = spec()
    filterSpec(input, pathSurface)
    expect(Object.keys(input.paths).sort()).toEqual(['/drop', '/keep'])
    expect(input.components.schemas).toHaveProperty('Unrelated')
  })

  it('fails loudly when upstream stops serving a declared operation', () => {
    // Silently shipping a smaller client is the worst possible outcome here:
    // it is a breaking change for consumers that would look like a patch.
    expect(() => filterSpec(spec(), { paths: { '/gone': ['get'] } })).toThrow(/no longer serves/)
    expect(() => filterSpec(spec(), { paths: { '/keep': ['delete'] } })).toThrow(/DELETE \/keep/)
  })
})

describe('filterSpec with a tag surface', () => {
  it('keeps operations carrying an allow-listed tag', () => {
    const out = filterSpec(spec(), { tags: ['Other'] })
    expect(Object.keys(out.paths)).toEqual(['/keep'])
    expect(out.paths['/keep']).toHaveProperty('get')
    expect(out.paths['/keep']).not.toHaveProperty('post')
  })

  it('refuses to silently produce an empty client', () => {
    expect(() => filterSpec(spec(), { tags: ['Absent'] })).toThrow(/serves no operations under tag/)
  })
})

describe('filterSpec surface validation', () => {
  it('requires a paths or tags surface', () => {
    expect(() => filterSpec(spec(), {})).toThrow(/either `paths` or `tags`/)
  })
})

describe('tag surface validation', () => {
  it('fails when a declared tag matches nothing upstream', () => {
    // The tag equivalent of a removed path. Without this, an upstream tag
    // rename empties the client and classifies as a documentation change.
    expect(() => filterSpec(spec(), { tags: ['Renamed'] })).toThrow(/serves no operations under tag/)
  })

  it('names only the tags that are actually missing', () => {
    expect(() => filterSpec(spec(), { tags: ['Other', 'Gone'] })).toThrow(/Gone/)
  })

  it('passes when every declared tag matches at least one operation', () => {
    expect(() => filterSpec(spec(), { tags: ['Other'] })).not.toThrow()
  })
})
