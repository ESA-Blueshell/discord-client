/**
 * Canonicalisation of an upstream OpenAPI document.
 *
 * Upstream publishes YAML (Brevo) or JSON (Discord) with unstable key order and
 * incidental whitespace. Every downstream step — the byte comparison that decides
 * whether anything changed at all, the sha256 in the lock file, the diff a reviewer
 * reads — depends on the same input producing the same bytes. So the document is
 * parsed and re-serialised with sorted keys rather than stored as fetched.
 */

/** Recursively sort object keys so serialisation is order-independent. */
export function sortKeys(node) {
  if (Array.isArray(node)) return node.map(sortKeys)
  if (node !== null && typeof node === 'object') {
    return Object.fromEntries(
      Object.keys(node)
        .sort()
        .map((key) => [key, sortKeys(node[key])]),
    )
  }
  return node
}

function assertLooksLikeSpec(spec) {
  if (spec === null || typeof spec !== 'object') {
    throw new Error('Spec did not parse to an object; upstream may have served an error page.')
  }
  if (!spec.openapi && !spec.swagger) {
    throw new Error('Parsed document has neither an `openapi` nor a `swagger` key; not an OpenAPI spec.')
  }
  return spec
}

/**
 * Parses a JSON spec body with no third-party dependency.
 *
 * The committed spec is always canonical JSON, so every step that reads it back
 * — the CI check, the generator-input step the Gradle build shells out to — runs
 * on a bare Node with no `npm install` first. Only fetching an upstream document
 * that is genuinely YAML needs the parser, and that happens in `sync` alone.
 */
export function parseJsonSpec(raw) {
  return assertLooksLikeSpec(sortKeys(JSON.parse(raw)))
}

/**
 * Parses a raw spec body that may be JSON or YAML, into a key-sorted object.
 * YAML support is imported lazily so JSON-only callers keep needing no deps.
 */
export async function parseAnySpec(raw) {
  try {
    return parseJsonSpec(raw)
  } catch (jsonError) {
    if (jsonError instanceof SyntaxError) {
      const { parse: parseYaml } = await import('yaml')
      return assertLooksLikeSpec(sortKeys(parseYaml(raw, { maxAliasCount: -1 })))
    }
    throw jsonError
  }
}

/** Deterministic on-disk form: sorted keys, 2-space indent, trailing newline. */
export function serialiseSpec(spec) {
  return `${JSON.stringify(sortKeys(spec), null, 2)}\n`
}
