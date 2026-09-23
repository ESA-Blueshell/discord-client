/**
 * Workarounds for shapes openapi-generator cannot render, applied to a copy of
 * the versioned spec on its way into the generators.
 *
 * These are deliberately NOT baked into `specs/discord.json`. That file is the
 * versioned contract and is compared against upstream to decide release numbers,
 * so it stays faithful to what Discord actually publishes. `type: "null"` really
 * does mean null upstream; rewriting it in the vendored copy would make the
 * committed spec lie and would hide the rewrite from the diff a reviewer reads.
 * Confining the hacks here keeps the contract honest and the workarounds visible.
 *
 * `collapseNullableUnions`, `rewriteNullTypes`, `collapseRedundantEnumAllOf` and
 * `keepJsonRequestBodies` are the four Discord needs. `dropConstraintOnlyCompositions` is carried from
 * the Brevo client so both repositories apply an identical set; it is a harmless
 * no-op here.
 */

/**
 * Rewrites `oneOf`/`anyOf: [{ type: "null" }, X]` as X, and drops a property so
 * rewritten from its parent's `required` list.
 *
 * Discord writes every nullable reference that way: `afk_channel_id` is a null
 * or a `SnowflakeType`, `primary_guild` a null or a `UserPrimaryGuildResponse`.
 * Left alone, `rewriteNullTypes` turns the null branch into a boolean and
 * openapi-generator renders the union as a wrapper class with no constructor
 * Jackson can call from a string, so reading any response carrying one fails
 * at runtime. The rewrite must run first. Leaving `required` makes the
 * generated field nullable, which is what the null branch said.
 */
export function collapseNullableUnions(node) {
  if (Array.isArray(node)) {
    node.forEach(collapseNullableUnions)
    return node
  }
  if (node === null || typeof node !== 'object') return node

  for (const [name, property] of Object.entries(node.properties ?? {})) {
    const collapsed = withoutNullBranch(property)
    if (collapsed === undefined) continue
    node.properties[name] = collapsed
    if (Array.isArray(node.required)) node.required = node.required.filter((one) => one !== name)
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties') continue
    const collapsed = withoutNullBranch(value)
    if (collapsed !== undefined) node[key] = collapsed
  }

  Object.values(node).forEach(collapseNullableUnions)
  return node
}

/** The non-null branch of a two-branch union with `{ type: "null" }`, keeping its siblings; otherwise undefined. */
function withoutNullBranch(schema) {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return undefined
  for (const keyword of ['oneOf', 'anyOf']) {
    const branches = schema[keyword]
    if (!Array.isArray(branches) || branches.length !== 2) continue
    const nulls = branches.filter((branch) => branch?.type === 'null' && Object.keys(branch).length === 1)
    if (nulls.length !== 1) continue
    const { [keyword]: _union, ...siblings } = schema
    return { ...siblings, ...branches.find((branch) => !nulls.includes(branch)) }
  }
  return undefined
}

/**
 * Discord's OpenAPI 3.1 document uses `type: "null"` as a marker-flag shape on a
 * few role-tag fields (present == true, absent == false). openapi-generator has
 * no Java/Kotlin type for that and emits a reference to a `ModelNull` class it
 * never generates, so compilation fails on a missing import. Boolean preserves
 * the "present means true" semantics the field actually carries.
 */
export function rewriteNullTypes(node) {
  if (Array.isArray(node)) {
    node.forEach(rewriteNullTypes)
    return node
  }
  if (node !== null && typeof node === 'object') {
    if (node.type === 'null') node.type = 'boolean'
    Object.values(node).forEach(rewriteNullTypes)
  }
  return node
}

/**
 * Collapses `{ allOf: [{ $ref }], enum: [...] }` to a bare `{ $ref }`.
 *
 * A handful of properties (GuildStickerResponse.type among them) both `$ref` an
 * integer enum and re-declare a narrowing `enum` beside it. openapi-generator
 * renders that as String-valued constants on a field typed as the referenced
 * enum, which does not compile. Dropping the redundant narrowing reuses the
 * referenced enum as-is; the narrowing was never enforced by the client anyway.
 */
export function collapseRedundantEnumAllOf(node) {
  if (Array.isArray(node)) {
    node.forEach(collapseRedundantEnumAllOf)
    return node
  }
  if (node !== null && typeof node === 'object') {
    const allOf = node.allOf
    if (Array.isArray(allOf) && allOf.length === 1 && typeof allOf[0]?.$ref === 'string' && 'enum' in node) {
      const ref = allOf[0].$ref
      for (const key of Object.keys(node)) delete node[key]
      node.$ref = ref
      return node
    }
    Object.values(node).forEach(collapseRedundantEnumAllOf)
  }
  return node
}

/**
 * Drops `anyOf`/`oneOf` branches that carry only a `required` list.
 *
 * Brevo expresses "one of these fields must be present" as:
 *
 *   { properties: { email: {...}, params: {...} },
 *     anyOf: [ { required: ["email"] }, { required: ["params"] } ] }
 *
 * The branches declare no type, no properties and no `$ref` — they are
 * constraints on the parent, not variant types. openapi-generator sees a
 * composition, treats the schema as polymorphic, and discards the sibling
 * `properties` entirely, emitting `data class Foo()` with no parameters. Kotlin
 * rejects that outright ("data class must have at least one primary constructor
 * parameter"), so the client does not compile.
 *
 * Dropping the composition keeps `email` and `params` as optional fields. The
 * either/or requirement is lost, but a generated client never enforced it — the
 * server does, and it still will.
 */
export function dropConstraintOnlyCompositions(node) {
  if (Array.isArray(node)) {
    node.forEach(dropConstraintOnlyCompositions)
    return node
  }
  if (node === null || typeof node !== 'object') return node

  for (const keyword of ['anyOf', 'oneOf']) {
    const branches = node[keyword]
    if (!Array.isArray(branches) || branches.length === 0) continue

    const everyBranchIsConstraintOnly = branches.every(
      (branch) =>
        branch !== null &&
        typeof branch === 'object' &&
        Array.isArray(branch.required) &&
        !('type' in branch) &&
        !('properties' in branch) &&
        !('$ref' in branch) &&
        !('items' in branch) &&
        !('allOf' in branch) &&
        !('anyOf' in branch) &&
        !('oneOf' in branch),
    )
    if (!everyBranchIsConstraintOnly) continue

    delete node[keyword]
    // With the composition gone, a schema that had no properties of its own
    // would still render as an empty data class. Free-form is the honest
    // reading of "an object we know nothing structural about".
    if (node.properties === undefined && node.additionalProperties === undefined) {
      node.type ??= 'object'
      node.additionalProperties = true
    }
  }

  Object.values(node).forEach(dropConstraintOnlyCompositions)
  return node
}

/**
 * Keeps only the `application/json` body of an operation that also offers form
 * encodings.
 *
 * Discord's message endpoints take the same body as JSON, as a urlencoded form,
 * or as `multipart/form-data` for file uploads, where it is an inline `allOf` of
 * the JSON schema and numbered `files[n]` parts. openapi-generator picks the
 * multipart variant, names an inline model for it (`CreateMessageRequest`) and
 * never generates it, so the Kotlin client does not compile. The clients send
 * JSON, so the JSON body is the one they need; uploading files is left out until
 * something asks for it.
 */
export function keepJsonRequestBodies(spec) {
  for (const operations of Object.values(spec.paths ?? {})) {
    for (const operation of Object.values(operations ?? {})) {
      const content = operation?.requestBody?.content
      if (content === undefined || !('application/json' in content)) continue
      for (const type of Object.keys(content)) {
        if (type !== 'application/json') delete content[type]
      }
    }
  }
  return spec
}

/** Applies every generator workaround to a deep copy, leaving the input untouched. */
export function applyGeneratorFixups(spec) {
  const copy = structuredClone(spec)
  collapseNullableUnions(copy)
  rewriteNullTypes(copy)
  collapseRedundantEnumAllOf(copy)
  dropConstraintOnlyCompositions(copy)
  keepJsonRequestBodies(copy)
  return copy
}
