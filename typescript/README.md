# discord-client

Generated Kotlin and TypeScript clients for the part of the
[Discord HTTP API](https://discord.com/developers/docs/reference) that
ESA-Blueshell actually calls.

Both artefacts are generated from a single OpenAPI surface, released together,
and share one version number that is derived from what changed upstream. Nothing
here is written by hand except the small amount of wiring in
`typescript/src/index.ts` and the pipeline under `tools/`.

| | |
| --- | --- |
| Maven | `net.blueshell.clients:discord-client` |
| npm | `@esa-blueshell/discord-client` |
| Operations exposed | 8 ([`specs/surface.json`](specs/surface.json)) |
| Upstream | [discord/discord-api-spec](https://github.com/discord/discord-api-spec) |
| Spec refreshed | nightly, 00:00 UTC |

## Installing

> [!IMPORTANT]
> Both packages live in **GitHub Packages**, which requires an access token to
> install *even though the packages are public*. This is a GitHub limitation,
> not a setting on these repositories — only its Container registry serves
> anonymous pulls. A token with `read:packages` is enough, and any GitHub
> account can create one.

### TypeScript

`.npmrc`, alongside your `package.json`:

```ini
@esa-blueshell:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```bash
npm install @esa-blueshell/discord-client
```

```ts
import { createDiscordClient, getMyUser, listGuildRoles } from '@esa-blueshell/discord-client'

const client = createDiscordClient({ botToken: process.env.DISCORD_BOT_TOKEN! })

const { data: me } = await getMyUser({ client })
const { data: roles } = await listGuildRoles({ client, path: { guild_id: GUILD_ID } })
```

`axios` is a peer dependency, so your application pins the version.

`getGuildWidget` reads `/guilds/{id}/widget.json`, the one endpoint here that
needs no authentication — useful for public pages. Its `WidgetResponse`,
`WidgetMember` and `WidgetChannel` types are exported whether or not you call
the operation.

Operations return `{ data, error, status }` rather than throwing, so a missing
`try`/`catch` cannot swallow a failure.

### Kotlin

```kotlin
repositories {
    maven {
        url = uri("https://maven.pkg.github.com/ESA-Blueshell/discord-client")
        credentials {
            username = providers.gradleProperty("gpr.user").orNull
            password = providers.gradleProperty("gpr.token").orNull
        }
    }
}

dependencies {
    implementation("net.blueshell.clients:discord-client:<version>")
}
```

```kotlin
val api = DiscordClient.create(botToken = System.getenv("DISCORD_BOT_TOKEN"))

val me = api.getMyUser()
val roles = api.listGuildRoles(guildId = guildId)
```

Errors surface as `RestClientResponseException`, which carries the status code —
needed to tell a rate limit from a permission problem.

> [!TIP]
> Use `DiscordClient.create(...)`, not the generated `DiscordApi(baseUrl)`
> constructor. That constructor wires no authentication at all, so every call
> through it returns 401. `DiscordClient` adds the bearer token and otherwise
> mirrors its converter setup.
>
> `DiscordClient.using(restClient)` wraps a `RestClient` you have configured
> yourself, if your application routes all outbound calls through its own
> builder.

> [!IMPORTANT]
> Discord IDs are **strings**, not numbers. They exceed the 64-bit signed range,
> and treating one as a number silently truncates it. The `after` pagination
> cursor changed from `integer` to `string` upstream — see
> [docs/versioning.md](docs/versioning.md).

### Jackson

Both clients are generated against **Jackson 3** (`tools.jackson.*`) and Spring
Boot 4, matching ESA-Blueshell/website. Only the annotations remain on the
Jackson 2 coordinate (`com.fasterxml.jackson.annotation`), which is where
Jackson 3 left them; their version comes from the Jackson 3 BOM.

A consumer on Jackson 3 can therefore share one mapper stack with this client
instead of carrying two Jackson majors on the classpath.

## How it stays current

A nightly workflow fetches the upstream spec, reduces it to the operations
declared in `specs/surface.json`, and classifies any change with `oasdiff`:

- breaking change → **major**
- addition → **minor**
- documentation only → **patch**
- consumed surface unchanged → nothing at all

It then regenerates both clients, runs their tests, and opens a single pull
request whose title is a conventional commit encoding the bump. Merging it lets
release-please cut the version and publish.

> [!NOTE]
> GitHub does not run `pull_request` workflows on a pull request opened by the
> default `GITHUB_TOKEN`, so the nightly and release pull requests show no
> checks out of the box. The sync job builds and tests both clients *before*
> opening the PR, so nothing ships unverified — the evidence is in the workflow
> run. To get checks on the PR itself, add an `AUTOMATION_TOKEN` secret (a PAT
> or GitHub App token with `contents` and `pull-requests` write); both
> workflows pick it up automatically and fall back to the default token.

Discord's full document changes most days; the operations here change rarely.
Filtering before classifying is what keeps the version number meaningful — see
[docs/versioning.md](docs/versioning.md) for the measurements behind that.

## Adding an operation

Edit [`specs/surface.json`](specs/surface.json), then:

```bash
npm --prefix tools ci
npm --prefix tools run sync          # refetches, filters, classifies
npm --prefix typescript run generate # regenerates the TypeScript client
```

Commit as `feat(spec): expose GET /guilds/{guild_id}/channels`. Or just open an
issue with the [operation request template](.github/ISSUE_TEMPLATE/surface-request.yml).

## Working on it

```bash
npm --prefix tools ci && npm --prefix tools test   # pipeline tests
(cd kotlin && ./gradlew build)                     # generate, compile, test
(cd typescript && npm ci && npm test)              # typecheck and test
node tools/src/cli.mjs check                       # the CI spec gate
```

The Kotlin build shells out to `node` for the generator-fixup step so both
languages apply an identical set of workarounds. No `npm install` is needed for
that path — it reads only JSON and imports nothing.

## Layout

```
specs/       surface.json (what we expose) + the filtered spec + upstream lock
tools/       fetch, filter, classify, fixups — with tests
kotlin/      Gradle build; generated at compile time into build/
typescript/  hey-api client; generated tree is committed under src/generated
docs/        versioning.md
```

`typescript/src/generated` is committed and `kotlin`'s is not, on purpose: the
committed TypeScript tree makes the nightly pull request show the real client
diff a reviewer needs to judge a version bump, and CI proves it reproduces.
