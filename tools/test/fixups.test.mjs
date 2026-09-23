import { describe, expect, it } from 'vitest'
import { applyGeneratorFixups, collapseNullableUnions, collapseRedundantEnumAllOf, dropConstraintOnlyCompositions, keepJsonRequestBodies, rewriteNullTypes } from '../src/fixups.mjs'

describe('collapseNullableUnions', () => {
  it('reads a nullable reference as the reference, no longer required, its description kept', () => {
    // Left as a union, the generator renders a wrapper class Jackson cannot
    // build from the snowflake string Discord sends, and every read fails.
    const out = collapseNullableUnions({
      required: ['id', 'afk_channel_id'],
      properties: {
        id: { $ref: '#/components/schemas/SnowflakeType' },
        afk_channel_id: { description: 'd', oneOf: [{ type: 'null' }, { $ref: '#/components/schemas/SnowflakeType' }] },
      },
    })
    expect(out.properties.afk_channel_id).toEqual({ description: 'd', $ref: '#/components/schemas/SnowflakeType' })
    expect(out.required).toEqual(['id'])
  })

  it('collapses anyOf and a null branch in either place, at any depth', () => {
    const out = collapseNullableUnions({
      a: { properties: { b: { anyOf: [{ $ref: '#/x' }, { type: 'null' }] } } },
      items: { oneOf: [{ type: 'null' }, { type: 'string' }] },
    })
    expect(out.a.properties.b).toEqual({ $ref: '#/x' })
    expect(out.items).toEqual({ type: 'string' })
  })

  it('leaves real unions alone', () => {
    const node = {
      properties: {
        many: { oneOf: [{ type: 'null' }, { $ref: '#/a' }, { $ref: '#/b' }] },
        two: { oneOf: [{ $ref: '#/a' }, { $ref: '#/b' }] },
        marked: { oneOf: [{ type: 'null', description: 'present means true' }, { $ref: '#/a' }] },
      },
      required: ['many', 'two', 'marked'],
    }
    expect(collapseNullableUnions(structuredClone(node))).toEqual(node)
  })

  it('runs before the null types become booleans', () => {
    const out = applyGeneratorFixups({ components: { schemas: { G: { properties: { c: { oneOf: [{ type: 'null' }, { $ref: '#/s' }] } } } } } })
    expect(out.components.schemas.G.properties.c).toEqual({ $ref: '#/s' })
  })
})

describe('rewriteNullTypes', () => {
  it('rewrites type: null to boolean at any depth', () => {
    // openapi-generator emits a reference to a ModelNull class it never
    // generates, so the client fails to compile on a missing import.
    const out = rewriteNullTypes({ a: { type: 'null' }, b: [{ c: { type: 'null' } }] })
    expect(out.a.type).toBe('boolean')
    expect(out.b[0].c.type).toBe('boolean')
  })

  it('leaves other types alone', () => {
    expect(rewriteNullTypes({ type: 'string' }).type).toBe('string')
  })
})

describe('collapseRedundantEnumAllOf', () => {
  it('collapses a single-ref allOf carrying a narrowing enum to the bare ref', () => {
    const out = collapseRedundantEnumAllOf({ allOf: [{ $ref: '#/components/schemas/E' }], enum: [1, 2], description: 'd' })
    expect(out).toEqual({ $ref: '#/components/schemas/E' })
  })

  it('leaves an allOf without an enum untouched', () => {
    const node = { allOf: [{ $ref: '#/components/schemas/E' }] }
    expect(collapseRedundantEnumAllOf(structuredClone(node))).toEqual(node)
  })

  it('leaves a multi-element allOf untouched', () => {
    const node = { allOf: [{ $ref: '#/a' }, { $ref: '#/b' }], enum: [1] }
    expect(collapseRedundantEnumAllOf(structuredClone(node))).toEqual(node)
  })

  it('recurses into nested properties', () => {
    const out = collapseRedundantEnumAllOf({
      properties: { t: { allOf: [{ $ref: '#/components/schemas/E' }], enum: [1] } },
    })
    expect(out.properties.t).toEqual({ $ref: '#/components/schemas/E' })
  })
})

describe('applyGeneratorFixups', () => {
  it('does not mutate the versioned spec it is handed', () => {
    // The vendored spec is the versioned contract and is diffed against
    // upstream to pick release numbers; mutating it here would make the
    // committed contract disagree with what was actually published.
    const input = { components: { schemas: { A: { type: 'null' } } } }
    const out = applyGeneratorFixups(input)
    expect(input.components.schemas.A.type).toBe('null')
    expect(out.components.schemas.A.type).toBe('boolean')
  })
})

describe('dropConstraintOnlyCompositions', () => {
  it('drops an anyOf whose branches only declare required, keeping sibling properties', () => {
    // Brevo's "one of email or params" idiom. openapi-generator otherwise
    // discards the properties and emits `data class Foo()`, which Kotlin
    // rejects: "data class must have at least one primary constructor parameter".
    const out = dropConstraintOnlyCompositions({
      properties: { email: { type: 'string' }, params: { type: 'object' } },
      anyOf: [{ required: ['email'] }, { required: ['params'] }],
    })
    expect(out.anyOf).toBeUndefined()
    expect(Object.keys(out.properties).sort()).toEqual(['email', 'params'])
  })

  it('handles oneOf the same way', () => {
    const out = dropConstraintOnlyCompositions({
      properties: { a: { type: 'string' } },
      oneOf: [{ required: ['a'] }],
    })
    expect(out.oneOf).toBeUndefined()
  })

  it('leaves a genuine polymorphic anyOf untouched', () => {
    // Branches with a $ref or a type are real variant types, not constraints.
    const real = { anyOf: [{ $ref: '#/components/schemas/A' }, { type: 'string' }] }
    expect(dropConstraintOnlyCompositions(structuredClone(real))).toEqual(real)
  })

  it('leaves an anyOf mixing constraints and real types untouched', () => {
    const mixed = { anyOf: [{ required: ['a'] }, { type: 'object', properties: { b: {} } }] }
    expect(dropConstraintOnlyCompositions(structuredClone(mixed))).toEqual(mixed)
  })

  it('makes a constraint-only schema with no properties free-form', () => {
    const out = dropConstraintOnlyCompositions({ anyOf: [{ required: ['a'] }] })
    expect(out.anyOf).toBeUndefined()
    expect(out.type).toBe('object')
    expect(out.additionalProperties).toBe(true)
  })

  it('recurses into nested schemas', () => {
    const out = dropConstraintOnlyCompositions({
      components: { schemas: { X: { properties: { a: {} }, anyOf: [{ required: ['a'] }] } } },
    })
    expect(out.components.schemas.X.anyOf).toBeUndefined()
  })
})

describe('keepJsonRequestBodies', () => {
  const body = { $ref: '#/components/schemas/MessageCreateRequest' }

  it('keeps only the JSON body where an operation also offers form encodings', () => {
    const spec = {
      paths: {
        '/channels/{channel_id}/messages': {
          post: {
            requestBody: {
              content: {
                'application/json': { schema: body },
                'application/x-www-form-urlencoded': { schema: body },
                'multipart/form-data': { schema: { allOf: [body] } },
              },
            },
          },
        },
      },
    }

    keepJsonRequestBodies(spec)

    expect(Object.keys(spec.paths['/channels/{channel_id}/messages'].post.requestBody.content)).toEqual(['application/json'])
  })

  it('leaves a body with no JSON variant, and an operation with no body, alone', () => {
    const spec = {
      paths: {
        '/upload': { post: { requestBody: { content: { 'multipart/form-data': { schema: {} } } } } },
        '/users/@me': { get: { responses: {} } },
      },
    }

    keepJsonRequestBodies(spec)

    expect(Object.keys(spec.paths['/upload'].post.requestBody.content)).toEqual(['multipart/form-data'])
    expect(spec.paths['/users/@me'].get).toEqual({ responses: {} })
  })
})
