# Security policy

## Reporting

Report a vulnerability through
[private vulnerability reporting](https://github.com/ESA-Blueshell/discord-client/security/advisories/new)
rather than a public issue.

## Scope

This repository publishes generated API clients. The plausible security
concerns are narrow, and worth naming:

- **Supply chain.** Every GitHub Action is pinned by commit SHA, and `oasdiff`
  runs from a digest-pinned container. That pin matters more than it looks:
  `oasdiff` decides published version numbers, so a silently-changed classifier
  could ship a breaking change as a patch. Dependabot proposes updates only
  after a release has been on its registry for **seven days**, leaving time for
  a compromised version to be yanked before it reaches a pull request.
- **Credential handling.** The clients take a bot token and send it as an
  `Authorization` header. Nothing is logged, cached or persisted. `createDiscordClient`
  rejects a token that already carries the `Bot ` prefix so a malformed header
  fails locally rather than being sent.
- **Spec provenance.** `specs/*.lock.json` records the upstream URL and the
  sha256 of exactly what was fetched, and CI verifies the committed surface
  hashes to what the lock claims.

## Not in scope

Vulnerabilities in the Discord API itself belong
[upstream](https://github.com/discord/discord-api-docs/issues).
