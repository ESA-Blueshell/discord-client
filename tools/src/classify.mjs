/**
 * Derives a semver bump from the difference between two versions of the
 * versioned spec surface.
 *
 * The mapping is deliberately blunt, because a generated client's compatibility
 * is a property of its spec and nothing else:
 *
 *   oasdiff reports a breaking change   -> major   (a consumer's code stops compiling
 *                                                   or starts getting rejected)
 *   oasdiff reports only additions      -> minor   (new operations/fields; existing
 *                                                   call sites keep working)
 *   bytes differ, no semantic change    -> patch   (descriptions, examples, ordering —
 *                                                   regenerates the client but cannot
 *                                                   change its behaviour)
 *   bytes identical                     -> none    (nothing to release)
 *
 * `oasdiff breaking` returns WARN(2) and ERR(3) findings; `oasdiff changelog`
 * returns those plus INFO(1) additions. Breaking is therefore checked first —
 * the changelog is a superset and would otherwise mask a major as a minor.
 */

import { execFileSync } from 'node:child_process'

export const LEVEL = { INFO: 1, WARN: 2, ERR: 3 }

/**
 * Pure mapping from oasdiff output to a bump level. Separated from the binary
 * so it can be unit-tested against recorded findings rather than a live diff.
 *
 * @param {object} input
 * @param {Array}  input.breaking   findings from `oasdiff breaking`
 * @param {Array}  input.changelog  findings from `oasdiff changelog`
 * @param {boolean} input.bytesChanged whether the canonical spec bytes differ
 * @param {number} [input.majorAtLevel] lowest oasdiff level treated as major
 */
export function classify({ breaking, changelog, bytesChanged, majorAtLevel = LEVEL.WARN }) {
  const majorFindings = (breaking ?? []).filter((f) => (f.level ?? LEVEL.ERR) >= majorAtLevel)
  if (majorFindings.length > 0) {
    return { bump: 'major', reason: 'breaking changes on the consumed surface', findings: majorFindings }
  }
  // A breaking finding below the major threshold still changes behaviour, so it
  // rides out as a minor rather than being silently downgraded to a patch.
  const additions = changelog ?? []
  if (additions.length > 0) {
    return { bump: 'minor', reason: 'additive or non-breaking changes on the consumed surface', findings: additions }
  }
  if (bytesChanged) {
    return { bump: 'patch', reason: 'documentation-only spec changes (no semantic difference)', findings: [] }
  }
  return { bump: 'none', reason: 'consumed surface is unchanged', findings: [] }
}

/**
 * Runs oasdiff via its published container. Pinned by digest: this decides
 * released version numbers, so a silently-changed classifier is a supply-chain
 * problem and not merely a build-reproducibility one.
 */
export const OASDIFF_IMAGE =
  'tufin/oasdiff@sha256:5825ff98b9f34737dfd864f390f2d00da454db87bb516f90fcab766ce82d9366'

function runOasdiff(subcommand, baseAbs, revisionAbs, { image = OASDIFF_IMAGE } = {}) {
  const stdout = execFileSync(
    'docker',
    [
      'run', '--rm', '--network', 'none',
      '-v', `${baseAbs}:/specs/base.json:ro`,
      '-v', `${revisionAbs}:/specs/revision.json:ro`,
      image,
      subcommand, '/specs/base.json', '/specs/revision.json', '-f', 'json',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  const trimmed = stdout.trim()
  if (trimmed === '') return []
  const parsed = JSON.parse(trimmed)
  return Array.isArray(parsed) ? parsed : []
}

/** Diffs two canonical spec files on disk and returns the bump plus findings. */
export function classifyFiles(baseAbs, revisionAbs, { bytesChanged, majorAtLevel, image } = {}) {
  const breaking = runOasdiff('breaking', baseAbs, revisionAbs, { image })
  const changelog = runOasdiff('changelog', baseAbs, revisionAbs, { image })
  return { ...classify({ breaking, changelog, bytesChanged, majorAtLevel }), breaking, changelog }
}

/**
 * The conventional-commit subject/body that carries `bump` through to
 * release-please, which is the single authority on the resulting version number.
 * Encoding the bump in the commit rather than writing a version directly keeps
 * one versioning mechanism instead of two that can disagree.
 */
export function commitMessage({ bump, reason, findings, upstreamVersion, api }) {
  const scope = 'spec'
  const summary = {
    major: `regenerate ${api} client for breaking upstream spec changes`,
    minor: `regenerate ${api} client for new upstream spec surface`,
    patch: `refresh ${api} client from upstream spec`,
  }[bump]

  const type = bump === 'patch' ? 'fix' : 'feat'
  const bang = bump === 'major' ? '!' : ''
  const lines = [`${type}(${scope})${bang}: ${summary}`, '']

  lines.push(`Upstream spec version: ${upstreamVersion ?? 'unversioned'}`)
  lines.push(`Classified as: ${bump} (${reason})`)

  if (findings.length > 0) {
    lines.push('', 'Changes on the consumed surface:')
    for (const finding of findings.slice(0, 50)) {
      const where = finding.operation && finding.path ? `${finding.operation} ${finding.path}: ` : ''
      lines.push(`  - ${where}${finding.text ?? finding.id}`)
    }
    if (findings.length > 50) lines.push(`  ... and ${findings.length - 50} more`)
  }

  if (bump === 'major') {
    // release-please reads this footer, not the `!`, when deciding to bump the
    // major on a 1.x line, so both are emitted.
    lines.push('', `BREAKING CHANGE: the upstream ${api} spec changed incompatibly on the operations this client exposes; regenerated method signatures or model fields may not match the previous release.`)
  }
  return `${lines.join('\n')}\n`
}
