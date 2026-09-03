#!/usr/bin/env node
/**
 * Spec pipeline entry point.
 *
 *   sync              fetch upstream, filter to the surface, classify the change,
 *                     write the vendored spec + lock, report the semver bump
 *   check             assert the vendored spec is canonical and matches its lock
 *   generator-input   write the fixed-up spec the code generators consume
 *                     (optionally to a given path, so each language build can
 *                     keep it inside its own build directory)
 *
 * `sync` writes its verdict to $GITHUB_OUTPUT when present so the workflow can
 * branch on it without re-parsing anything.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseAnySpec, parseJsonSpec, serialiseSpec } from './normalise.mjs'
import { filterSpec } from './filter.mjs'
import { classifyFiles, commitMessage } from './classify.mjs'
import { applyGeneratorFixups } from './fixups.mjs'
import { buildLock, serialiseLock, sha256 } from './lock.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Hosts this tool is allowed to fetch a spec from.
 *
 * `surface.json` names the upstream URL, so without this the file decides
 * where CI makes an outbound request to — and the fetched body is then written
 * into the repository. CodeQL flags exactly that pair (`js/file-access-to-http`
 * and `js/http-to-file-access`), and it is right to: a one-line edit to a
 * config file should not be able to point the nightly job at an arbitrary host.
 *
 * Held in code rather than in `surface.json` on purpose. A list living beside
 * the value it constrains constrains nothing.
 */
const ALLOWED_UPSTREAM_HOSTS = new Set([
  'api.brevo.com',
  'raw.githubusercontent.com',
])

/** Rejects anything that is not an https URL on an allowed host. */
function assertAllowedUpstream(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`specs/surface.json upstreamUrl is not a URL: ${rawUrl}`)
  }
  if (url.protocol !== 'https:') {
    throw new Error(`specs/surface.json upstreamUrl must be https, got ${url.protocol}`)
  }
  if (!ALLOWED_UPSTREAM_HOSTS.has(url.hostname)) {
    throw new Error(
      `specs/surface.json upstreamUrl host ${url.hostname} is not allowed. ` +
        `Add it to ALLOWED_UPSTREAM_HOSTS in tools/src/cli.mjs if it is genuinely intended.`,
    )
  }
  return url.href
}

/**
 * Rejects anything that is not a bare filename.
 *
 * The spec and lock file names come from `surface.json` too, and are joined
 * onto `specs/` before being written. A name containing a separator or `..`
 * would put the write outside the directory it belongs in.
 */
function assertBareFilename(value, field) {
  if (typeof value !== 'string' || value === '' || /[\\/]|^\.\.?$|\.\./.test(value)) {
    throw new Error(`specs/surface.json ${field} must be a bare filename, got ${JSON.stringify(value)}`)
  }
  return value
}

const surface = JSON.parse(readFileSync(resolve(repoRoot, 'specs/surface.json'), 'utf8'))
const upstreamUrl = assertAllowedUpstream(surface.upstreamUrl)
assertBareFilename(surface.specFile, 'specFile')
assertBareFilename(surface.lockFile, 'lockFile')

const specPath = resolve(repoRoot, 'specs', surface.specFile)
const lockPath = resolve(repoRoot, 'specs', surface.lockFile)
const generatorInputPath = resolve(repoRoot, 'build/generator-input.json')

function writeFile(path, contents) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

function emitOutputs(values) {
  const target = process.env.GITHUB_OUTPUT
  for (const [key, value] of Object.entries(values)) {
    const single = String(value).includes('\n') ? null : String(value)
    if (single !== null) {
      console.log(`${key}=${single}`)
      if (target) appendFileSync(target, `${key}=${single}\n`)
    } else if (target) {
      const delimiter = `EOF_${key}_${Math.random().toString(36).slice(2)}`
      appendFileSync(target, `${key}<<${delimiter}\n${value}\n${delimiter}\n`)
    }
  }
}

async function fetchUpstream() {
  const response = await fetch(upstreamUrl, {
    headers: { accept: 'application/json, application/yaml, text/yaml, */*' },
    redirect: 'follow',
  })
  if (!response.ok) {
    throw new Error(`Upstream returned HTTP ${response.status} ${response.statusText} for ${upstreamUrl}`)
  }
  return await response.text()
}

/** Builds the canonical, versioned surface document from a raw upstream body. */
async function toVersionedSurface(rawBody) {
  const upstream = await parseAnySpec(rawBody)
  const filtered = filterSpec(upstream, surface)
  return { upstream, canonical: serialiseSpec(filtered) }
}

async function sync() {
  const rawBody = await fetchUpstream()
  const { upstream, canonical } = await toVersionedSurface(rawBody)

  const previous = existsSync(specPath) ? readFileSync(specPath, 'utf8') : null
  const bytesChanged = previous !== canonical

  if (previous === null) {
    // First run in a fresh repo: nothing to diff against, so seed the contract.
    writeFile(specPath, canonical)
    writeFile(lockPath, serialiseLock(buildLock({
      url: upstreamUrl, rawBody, spec: upstream,
      surfaceSha: sha256(canonical), fetchedAt: new Date().toISOString(),
    })))
    emitOutputs({ bump: 'none', changed: 'true', summary: 'Seeded the initial vendored spec surface.' })
    return
  }

  if (!bytesChanged) {
    // Upstream very likely moved somewhere in the document — Discord's full
    // spec changes most days — but nothing this client exposes did, so there is
    // nothing to release. Deliberately writes no files: refreshing the lock's
    // `fetchedAt` would commit a timestamp every single night and bury the
    // handful of commits that mean something. The workflow run is the record
    // that the check happened.
    const previousLock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : null
    const upstreamMoved = previousLock !== null && previousLock.upstream?.rawSha256 !== sha256(rawBody)
    emitOutputs({
      bump: 'none',
      changed: 'false',
      summary: upstreamMoved
        ? 'Upstream spec changed, but not on the consumed surface; nothing to release.'
        : 'Upstream spec is byte-identical to the recorded fetch; nothing to release.',
    })
    return
  }

  // Diff the old surface against the new one. Both are written to disk because
  // oasdiff reads files, and the previous copy must be the committed bytes.
  const previousPath = resolve(repoRoot, 'build/previous-surface.json')
  const revisionPath = resolve(repoRoot, 'build/revision-surface.json')
  writeFile(previousPath, previous)
  writeFile(revisionPath, canonical)

  const verdict = classifyFiles(previousPath, revisionPath, {
    bytesChanged,
    majorAtLevel: surface.majorAtLevel,
  })

  writeFile(specPath, canonical)
  writeFile(lockPath, serialiseLock(buildLock({
    url: upstreamUrl, rawBody, spec: upstream,
    surfaceSha: sha256(canonical), fetchedAt: new Date().toISOString(),
  })))

  const message = commitMessage({
    bump: verdict.bump,
    reason: verdict.reason,
    findings: verdict.findings,
    upstreamVersion: upstream?.info?.version,
    api: surface.apiName,
  })
  writeFile(resolve(repoRoot, 'build/commit-message.txt'), message)
  writeFile(resolve(repoRoot, 'build/findings.json'), `${JSON.stringify(verdict, null, 2)}\n`)

  emitOutputs({
    bump: verdict.bump,
    changed: 'true',
    summary: `${verdict.bump}: ${verdict.reason} (${verdict.findings.length} finding(s))`,
    commit_message: message,
  })
}

/**
 * CI guard. Re-derives what the vendored spec should look like from its own
 * bytes and checks the lock agrees, so a hand-edited spec or a stale lock fails
 * a pull request instead of quietly becoming the contract.
 */
function check() {
  const problems = []
  if (!existsSync(specPath)) {
    problems.push(`${surface.specFile} is missing.`)
  } else {
    const onDisk = readFileSync(specPath, 'utf8')
    const recanonicalised = serialiseSpec(parseJsonSpec(onDisk))
    if (onDisk !== recanonicalised) {
      problems.push(`${surface.specFile} is not in canonical form (sorted keys, 2-space indent, trailing newline). Run \`yarn sync\`.`)
    }
    // The committed surface must already be filtered: re-filtering is a no-op.
    const refiltered = serialiseSpec(filterSpec(parseJsonSpec(onDisk), surface))
    if (recanonicalised !== refiltered) {
      problems.push(`${surface.specFile} contains operations outside specs/surface.json. Run \`yarn sync\`.`)
    }
    if (existsSync(lockPath)) {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
      if (lock.surface?.sha256 !== sha256(onDisk)) {
        problems.push(`${surface.lockFile} records surface sha256 ${lock.surface?.sha256} but ${surface.specFile} hashes to ${sha256(onDisk)}.`)
      }
    } else {
      problems.push(`${surface.lockFile} is missing.`)
    }
  }

  if (problems.length > 0) {
    console.error('Spec check failed:')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log(`Spec check passed: ${surface.specFile} is canonical, filtered to the declared surface, and matches its lock.`)
}

function generatorInput() {
  const spec = parseJsonSpec(readFileSync(specPath, 'utf8'))
  const target = process.argv[3] ? resolve(process.cwd(), process.argv[3]) : generatorInputPath
  writeFile(target, serialiseSpec(applyGeneratorFixups(spec)))
  console.log(`Wrote generator input to ${target}`)
}

const command = process.argv[2]
const commands = { sync, check, 'generator-input': generatorInput }
if (!(command in commands)) {
  console.error(`Usage: cli.mjs <${Object.keys(commands).join('|')}>`)
  process.exit(2)
}
await commands[command]()
