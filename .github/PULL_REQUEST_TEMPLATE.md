<!--
Thanks for contributing! The title becomes the squash commit on main, so write it as a
Conventional Commit: `type(scope): summary`, e.g. `fix(viewer): keep marks when a screenshot is replaced`.
-->

## What and why

<!-- What changes for a user, and the problem it solves. Link the issue: "Closes #123". -->

## How I tested it

<!-- Commands you ran, the harness you installed into, the plan you ran. -->

- [ ] `node scripts/check.mjs` passes
- [ ] Installed from my checkout into a scratch project (`npx skills add <path> -a <agent> --copy`) and ran `examples/.qa` with: <!-- harness -->

## Checklist

- [ ] Tests added or updated in `test/` for changed behavior
- [ ] `CHANGELOG.md` has an entry under **Unreleased** (for user-visible changes)
- [ ] Generated files were rebuilt with `node scripts/build.mjs`, not edited by hand
- [ ] No npm dependencies added; Node 20 built-ins only
- [ ] Harness-specific tool names stay in `harness.mjs` or `references/harness/*.md`
- [ ] A changed schema bumps `schemaVersion` and still reads the old shape
- [ ] Docs (`SKILL.md`, references, README) match the new behavior
