# How versions are decided

The version number on both published artefacts describes **one thing**: the
consumed surface of the upstream API, as declared in
[`specs/surface.json`](../specs/surface.json). It is derived mechanically, not
chosen by a human.

## The rule

| What changed on the consumed surface | Bump | Conventional commit |
| --- | --- | --- |
| An operation, parameter or field was removed or changed incompatibly | **major** | `feat(spec)!:` + `BREAKING CHANGE:` footer |
| An operation or optional field was added | **minor** | `feat(spec):` |
| Only descriptions, examples or key ordering moved | **patch** | `fix(spec):` |
| Nothing this client exposes changed | none | no commit, no release |

The classification comes from [oasdiff](https://github.com/oasdiff/oasdiff),
run against the previous and new surface. `oasdiff breaking` is consulted first
because `oasdiff changelog` is a superset of it — checking the changelog first
would report a removed endpoint as a minor.

## Why the surface, not the upstream document

Discord publishes roughly 500 operations and 540 schemas. This client binds
seven operations and 34 schemas.

Measured when this repository was set up, the vendored Discord document had
drifted from upstream by **32 breaking changes and 154 total changes**. On the
seven operations this client actually exposes, the same drift was **two**
changes — both real, both breaking:

```
GET /guilds/{guild_id}/members
  - added the pattern ^(0|[1-9][0-9]*)$ to the query parameter `after`
  - the `after` parameter's type/format changed from integer to string/snowflake
```

Classifying the whole upstream document would have emitted a major bump every
night and told a consumer nothing. Classifying the consumed surface produced a
major bump that a consumer genuinely needed to know about: `after` changed from
a number to a string, and any call site passing a `Long` stops compiling.

That is the whole argument for the filter step, and it is why
`specs/discord.json` holds the filtered surface rather than the upstream file.

## Nothing waits for a human

The chain runs unattended, so the published clients stay in step with the
upstream spec rather than with whoever remembers to press merge:

```
upstream spec moves
  -> spec-sync filters, classifies, regenerates, builds, tests
  -> opens a pull request titled with the conventional commit
  -> merges it
  -> release-please opens a release pull request
  -> merges that
  -> tags, and publishes both artefacts
```

Merging the spec-sync pull request without review is safe for two specific
reasons rather than as a general policy. The job has already regenerated both
clients, compiled them and run their tests before it opens the pull request, so
a spec change that breaks generation never reaches the merge step. And the
surface guards fail the run outright if upstream stops serving a declared
operation or tag, so the failure that actually matters — silently publishing a
smaller client — cannot get there either.

**Majors merge too.** Consumers pin versions, so publishing a major breaks
nobody who has not chosen to upgrade, and semver is precisely how the break is
communicated. Holding a breaking spec change back would leave the client
describing an API that no longer exists, which is the worse failure. To review
majors by hand instead, set the repository variable:

```
HOLD_MAJOR_RELEASES=true
```

The release job is skipped on the run that follows a release, which is what
stops the two workflows from cycling.

### How the release pull request is verified

GitHub does not execute workflow runs for a pull request opened with the
default `GITHUB_TOKEN`. It creates the run, allocates no job, and concludes it
`failure` — measured here as `jobs=0` and a red mark on all four workflows of
every release pull request. Those marks say nothing about the change, and
merging past them is indistinguishable from merging past a real failure.

So the pull-request-triggered workflows skip the two bot branches entirely, and
`release.yml` verifies the release pull request itself: it checks out the pull
request's head, runs the spec gate, the pipeline tests, both client builds and
their tests, and confirms the version in `kotlin/gradle.properties` and
`typescript/package.json` matches what release-please is about to publish. The
merge job depends on that verification, so a release cannot merge on a check
that never ran.

### The one gap

`main` is protected by the `Main` ruleset — pull request required, squash only,
linear history, no force pushes or deletion. It deliberately does **not**
require a status check, because GitHub does not run workflows on pull requests
opened with the default `GITHUB_TOKEN`: a required check would never report on
an automated pull request and the chain above would stall forever.

To require the check as well, add an `AUTOMATION_TOKEN` secret (a PAT or GitHub
App token with `contents` and `pull-requests` write). Both workflows already
prefer it over the default token, so the automated pull requests would then run
CI like any other, `Verify spec, Kotlin and TypeScript` can be added to the
ruleset, and the `branches-ignore` exclusions plus the `verify-release-pr` job
can go away. Until then the verification lives in the workflows that have a
working token context rather than on the pull request.

## Who owns the number

Nothing writes a version directly. The nightly sync writes a **conventional
commit**, and [release-please](https://github.com/googleapis/release-please)
turns accumulated commits into a version and a tag. One mechanism, so there is
nothing for two systems to disagree about.

A major bump emits both the `!` marker and a `BREAKING CHANGE:` footer:
release-please reads the footer rather than the `!` when deciding to bump the
major on a `1.x` line, so emitting only one of the two can silently release a
breaking change as a minor.

## Changing the surface deliberately

Editing `specs/surface.json` is the supported way to add or drop an operation.

- **Adding** one: add the path and methods, run `npm --prefix tools run sync`,
  commit as `feat(spec): expose ...`. Minor release.
- **Removing** one: delete the entry and commit as `feat(spec)!: ...` with a
  `BREAKING CHANGE:` footer. Major release.

If upstream stops serving something the surface declares, the pipeline **fails
the run** rather than quietly generating a smaller client. Shipping a silently
reduced client is a breaking change wearing a patch's clothing, and it is the
single worst outcome this design is built to prevent.

## What is not covered

The spec is not the only thing that can break a consumer. A generator upgrade
can rename a model or change a method signature without the spec moving at all.
Those changes arrive through ordinary Dependabot pull requests and need a human
to write the conventional commit — the automation has no view into them.
