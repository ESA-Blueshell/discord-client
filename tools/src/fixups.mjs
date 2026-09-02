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
 * `rewriteNullTypes` and `collapseRedundantEnumAllOf` are the two Discord
 * needs. `dropConstraintOnlyCompositions` is carried from the Brevo client so
 * both repositories apply an identical set; it is a harmless no-op here.
 */

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

/** Applies every generator workaround to a deep copy, leaving the input untouched. */
export function applyGeneratorFixups(spec) {
  const copy = structuredClone(spec)
  rewriteNullTypes(copy)
  collapseRedundantEnumAllOf(copy)
  dropConstraintOnlyCompositions(copy)
  return copy
}
