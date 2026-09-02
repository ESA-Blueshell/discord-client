/**
 * Reduction of an upstream spec to the surface this client actually exposes.
 *
 * Why this exists at all: Discord publishes ~500 operations and ~540 schemas,
 * Brevo publishes a comparable sprawl, and this client binds a handful of each.
 * Generating the whole surface would be slow, would expose endpoints nobody
 * intends to call, and — the reason that actually forces the issue — would make
 * versioning meaningless. Measured against the vendored Discord spec, the full
 * document carried 32 breaking changes and 154 total changes, while the six
 * paths this client binds carried 2. Classifying the full document would emit a
 * major bump every night and tell a consumer nothing.
 *
 * So the filtered surface, not the upstream document, is the versioned contract.
 */

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'])
const SCHEMA_REF_PREFIX = '#/components/schemas/'

/** Collects every `#/components/schemas/<name>` reference in an arbitrary fragment. */
export function collectSchemaRefs(node, out = new Set()) {
  if (Array.isArray(node)) {
    for (const item of node) collectSchemaRefs(item, out)
    return out
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string' && value.startsWith(SCHEMA_REF_PREFIX)) {
        out.add(value.slice(SCHEMA_REF_PREFIX.length))
      } else {
        collectSchemaRefs(value, out)
      }
    }
  }
  return out
}

/** True when an operation should be kept, per a path- or tag-based surface. */
function operationAllowed(surface, path, method, operation) {
  if (surface.paths) {
    const allowed = surface.paths[path]
    return Array.isArray(allowed) && allowed.includes(method)
  }
  if (surface.tags) {
    const tags = operation?.tags ?? []
    return tags.some((tag) => surface.tags.includes(tag))
  }
  throw new Error('Surface must declare either `paths` or `tags`.')
}

/**
 * Filters `spec` down to `surface`.
 *
 * `surface` is one of:
 *   { paths: { "/guilds/{guild_id}": ["get"], ... }, tag?: "Discord" }
 *   { tags: ["TransactionalEmails", "Contacts"] }
 *
 * `surface.tag`, when set, is stamped onto every surviving operation. Discord
 * ships its operations untagged, and openapi-generator groups generated API
 * classes by tag — without this the generator emits one class named after the
 * spec title holding every operation.
 */
export function filterSpec(spec, surface) {
  const filtered = structuredClone(spec)
  const keptPaths = {}

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    if (pathItem === null || typeof pathItem !== 'object') continue
    const keptItem = {}
    let keptAnyOperation = false

    for (const [key, value] of Object.entries(pathItem)) {
      // Path-level siblings (parameters, servers, $ref, summary) ride along with
      // any operation that survives; they are not operations themselves.
      if (!HTTP_METHODS.has(key)) {
        keptItem[key] = value
        continue
      }
      if (!operationAllowed(surface, path, key, value)) continue
      keptItem[key] = surface.tag ? { ...value, tags: [surface.tag] } : value
      keptAnyOperation = true
    }

    if (keptAnyOperation) keptPaths[path] = keptItem
  }

  assertSurfaceFullyMatched(surface, spec.paths ?? {}, keptPaths)
  assertEveryTagMatched(surface, keptPaths)
  filtered.paths = keptPaths

  if (filtered.components?.schemas) {
    filtered.components.schemas = pruneSchemas(filtered.components, keptPaths)
  }
  return filtered
}

/**
 * Fails when a declared tag matched nothing.
 *
 * The tag equivalent of a removed path: if upstream renames or retires a tag,
 * filtering yields an empty client, every generated method disappears, and
 * without this the change classifies as a mere documentation edit. Upstream
 * renaming a tag is a routine event and must stop the run.
 */
function assertEveryTagMatched(surface, keptPaths) {
  if (!surface.tags) return
  const seen = new Set()
  for (const pathItem of Object.values(keptPaths)) {
    for (const operation of Object.values(pathItem)) {
      for (const tag of operation?.tags ?? []) seen.add(tag)
    }
  }
  const missing = surface.tags.filter((tag) => !seen.has(tag))
  if (missing.length > 0) {
    throw new Error(
      `Upstream serves no operations under tag(s) this client declares: ${missing.join(', ')}.\n` +
        `Upstream may have renamed or retired them. Correct specs/surface.json — ` +
        `dropping a tag is a breaking change for consumers.`,
    )
  }
}

/**
 * Keeps only schemas transitively reachable from the surviving paths.
 *
 * The seed deliberately includes every non-`schemas` component section. Those
 * sections (responses, parameters, requestBodies) stay in the document wholesale
 * and their `$ref`s remain live, so a schema reached only from
 * `components.responses` is still required. Seeding from paths alone produced a
 * spec that oasdiff rejected outright with `map key "ErrorResponse" not found`.
 */
function pruneSchemas(components, keptPaths) {
  const schemas = components.schemas
  const seed = collectSchemaRefs(keptPaths)
  for (const [section, value] of Object.entries(components)) {
    if (section !== 'schemas') collectSchemaRefs(value, seed)
  }

  const reachable = new Set()
  const queue = [...seed]
  while (queue.length > 0) {
    const name = queue.pop()
    if (reachable.has(name)) continue
    reachable.add(name)
    if (!(name in schemas)) continue
    for (const next of collectSchemaRefs(schemas[name])) {
      if (!reachable.has(next)) queue.push(next)
    }
  }

  return Object.fromEntries(
    Object.entries(schemas).filter(([name]) => reachable.has(name)),
  )
}

/**
 * Fails when the surface names something upstream no longer serves.
 *
 * Without this the pipeline treats a removed endpoint as "filtered to nothing"
 * and quietly ships a smaller client, which is precisely the breaking change a
 * consumer most needs told about. An upstream removal should stop the run and
 * demand a human decision, not slip out as a patch release.
 *
 * The two cases are reported separately because they call for different fixes:
 * a vanished path usually means upstream renamed or versioned it, while a
 * vanished method on a surviving path is a genuine capability removal.
 */
function assertSurfaceFullyMatched(surface, sourcePaths, keptPaths) {
  if (!surface.paths) return
  const missing = []
  for (const [path, methods] of Object.entries(surface.paths)) {
    if (!(path in sourcePaths)) {
      missing.push(`${path} (the whole path is absent upstream)`)
      continue
    }
    for (const method of methods) {
      if (!(method in (keptPaths[path] ?? {}))) {
        missing.push(`${method.toUpperCase()} ${path}`)
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Upstream no longer serves operations this client declares in its surface:\n` +
        missing.map((entry) => `  - ${entry}`).join('\n') +
        `\nRemove them from specs/surface.json (a breaking change for consumers) ` +
        `or correct the surface if upstream merely renamed the path.`,
    )
  }
}
