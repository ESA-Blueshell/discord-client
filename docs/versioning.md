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
