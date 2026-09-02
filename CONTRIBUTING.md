# Contributing

## The one rule

**Never hand-edit `specs/discord.json` or `typescript/src/generated`.** Both are
derived. CI checks that the spec is canonical, filtered to
`specs/surface.json`, and matches its lock file, and that the generated
TypeScript reproduces from it — so a hand edit fails the pull request rather
than becoming the contract.

To change what the client exposes, edit `specs/surface.json` and re-run the
pipeline. See [docs/versioning.md](docs/versioning.md).

## Commit messages

The pull request **title** becomes the commit on `main`, and release-please
reads it to decide the next version. It must be a conventional commit:

```
feat(spec): expose GET /guilds/{guild_id}/channels
fix(typescript): stop dropping the user agent header
chore(deps): bump kotlin to 2.4.11
```

A breaking change needs both `!` and a footer:

```
feat(spec)!: drop GET /users/@me

BREAKING CHANGE: getMyUser has been removed from both clients.
```

Emitting only one of the two can release a breaking change as a minor.

## Running everything

```bash
npm --prefix tools ci && npm --prefix tools test
(cd kotlin && ./gradlew build)
(cd typescript && npm ci && npm run typecheck && npm test && npm run build)
node tools/src/cli.mjs check
```

## Tests

The clients are generated, so the tests do not check generated logic. They check
the things that generation can silently get wrong:

- **Surface pinning** — both clients expose exactly the declared operations. A
  filter regression that dropped one would otherwise ship as a patch.
- **Request wiring** — paths, path parameters, query parameters, bodies, and
  that 19-digit snowflakes survive as strings.
- **Response deserialisation** — proven on the lightweight models. Discord's
  guild payload needs thirty-odd non-null fields across four levels of wrapper
  type; hand-building that would test the fixture, not the client, and would
  break on every upstream field addition.
- **The classifier** — the highest-value tests in the repository, because this
  logic decides published version numbers.
