<!--
The title of this pull request becomes the commit message on main, and
release-please reads it to decide the next version. It must be a conventional
commit — `feat(spec): ...`, `fix(kotlin): ...`, `chore(deps): ...`. A breaking
change needs both a `!` after the scope and a `BREAKING CHANGE:` footer below.
-->

## What this changes

## Why

## Version impact

<!-- Delete the lines that do not apply. -->

- [ ] **major** — an operation or field consumers use was removed or changed incompatibly
- [ ] **minor** — a new operation or optional field was added
- [ ] **patch** — documentation, tooling or a fix with no surface change
- [ ] **none** — no released artefact changes

## Checklist

- [ ] `specs/discord.json` was changed only by `tools/src/cli.mjs sync`, never by hand
- [ ] `typescript/src/generated` was regenerated if the spec moved (`npm run generate`)
- [ ] Both clients build and their tests pass
- [ ] If an operation was added or removed, `specs/surface.json` reflects it
