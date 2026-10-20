# Contributing to qa-runner

Thanks for helping. qa-runner is used by people who sign off releases, so we value changes that
are small, tested and easy to review over large ones. This guide covers how to propose a change,
set up the repo, and get a pull request merged.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a bug** with the [bug form](https://github.com/he1ox/AgenticTestRunner/issues/new?template=bug_report.yml).
  The smallest plan or command that shows it is the most useful thing you can attach.
- **Suggest a feature** with the [feature form](https://github.com/he1ox/AgenticTestRunner/issues/new?template=feature_request.yml),
  after checking the [roadmap](ROADMAP.md).
- **Ask a question or share an idea** in [Discussions](https://github.com/he1ox/AgenticTestRunner/discussions).
- **Fix or build something**: pick an issue labeled
  [`good first issue`](https://github.com/he1ox/AgenticTestRunner/labels/good%20first%20issue) or
  [`help wanted`](https://github.com/he1ox/AgenticTestRunner/labels/help%20wanted) and comment
  that you are on it.
- **Improve the docs**: the skills' `SKILL.md` and `references/`, the README, or the website in `site/`.
- **Report a vulnerability** privately, never in an issue: see [SECURITY.md](SECURITY.md).

For anything bigger than a bug fix (a new command, a schema change, support for another harness),
open an issue first so we can agree on the approach before you spend time on code.

## Set up

You need **Node.js 20 or newer** and Git. There is nothing to install: the project uses Node
built-ins only, with no `package.json` and no npm dependencies.

```bash
git clone https://github.com/<you>/AgenticTestRunner.git
cd AgenticTestRunner
node scripts/check.mjs
```

`check.mjs` runs exactly what CI runs on every pull request:

| Step | Command on its own |
| --- | --- |
| Skills follow the [Agent Skills spec](https://agentskills.io/specification) | `node scripts/validate-skills.mjs` |
| Generated agents and manifests are up to date | `node scripts/build.mjs --check` |
| Every tracked script parses | `node --check <file>` |
| Every tracked JSON file parses | (built in) |
| Tests pass | `node --test` |

CI also runs it on Linux, Windows and macOS with Node 20, 22 and 24, lints the workflows with
[actionlint](https://github.com/rhysd/actionlint), checks that `npx skills` lists every skill,
and runs CodeQL.

## Where things live

[AGENTS.md](AGENTS.md) is the map of the repository and its rules, written for coding agents and
humans alike. Read it before your first change. In short:

- `skills/` holds the four skills. `run-test-plan` owns the CLI (`scripts/qa-runs.mjs`), the
  viewer and the schemas; the others call that CLI.
- `skills/run-test-plan/scripts/harness.mjs` and `references/harness/*.md` hold everything that
  differs per agent harness.
- `test/` holds the `node:test` suite. `test/setup-project.mjs` gives each test file a temporary
  copy of `examples/.qa`, so tests never touch your own `.qa/`.
- `site/` is the landing page, plain HTML, CSS and JS, deployed to GitHub Pages from `main`.

## Rules that CI cannot fully check

- **Never edit generated files by hand.** `claude/agents/`, `plugin.json`, `mcp.json`,
  `.codex-plugin/`, `.agents/plugins/` and `gemini-extension.json` come from
  `skills/run-test-plan/scripts/agents.mjs` and `.claude-plugin/plugin.json`. Change those, then
  run `node scripts/build.mjs`.
- **No npm dependencies**, anywhere. Node 20 built-ins only.
- **Harness-neutral skills stay neutral**: tool names of one harness go in
  `references/harness/<name>.md`, never in a shared `SKILL.md`.
- **Schemas are contracts** read by older runs: bump `schemaVersion` and keep reading the old shape.
- **`SKILL.md` stays under 500 lines** and loads its references just in time.
- **Never commit real credentials or customer data**, including in example plans, screenshots
  and test fixtures. Use the placeholders the examples use.

## Make a change

1. Fork the repo and create a branch from `main`: `git switch -c fix/viewer-marks`.
2. Make the change, with tests in `test/` for the behavior you add or fix. Match the style of the
   code around it: ES modules, two-space indent, single quotes, comments that explain why.
3. Run `node scripts/check.mjs` until it passes.
4. Try it for real: install from your checkout into a scratch project and run the example plan
   with the harness you changed.

   ```bash
   npx skills add <path-to-your-checkout> -a <agent> --copy
   ```

5. Add a line to `CHANGELOG.md` under **Unreleased** if a user would notice the change.
6. Commit and open a pull request against `main`, filling in the template.

### Commit messages and pull request titles

We use [Conventional Commits](https://www.conventionalcommits.org). Pull requests are squash-merged,
so **the title of the pull request becomes the commit on `main`**; a check enforces its format.

```text
type(scope): summary in the imperative, lower case, no period
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`,
`revert`. The scope is optional and names the area: `viewer`, `cli`, `replay`, `export`, `site`,
`skills`, a harness name... Add `!` after the type for a breaking change and explain it in the
description, e.g. `feat(cli)!: rename --fail-on none to --no-gate`.

## Review

- A maintainer reviews every pull request; [CODEOWNERS](.github/CODEOWNERS) requests one
  automatically. Expect a first answer within a week.
- Every required check must pass and every conversation must be resolved before merge.
- Keep the pull request focused. Unrelated clean-ups belong in their own pull request.
- Push new commits while it is in review instead of force-pushing, so reviewers can see what
  changed. It is all squashed at the end.

## Releases

Maintainers release from `main`:

1. `node scripts/bump-version.mjs <x.y.z>` updates every manifest, skill and the website.
2. Move the **Unreleased** notes in `CHANGELOG.md` under `## <x.y.z> — <date>`, open a pull
   request `chore: release <x.y.z>` and merge it.
3. Tag the merge commit `v<x.y.z>` and push the tag. The `release` workflow checks the tag
   matches the version, runs every check and publishes the GitHub release from the changelog.

Versions follow [Semantic Versioning](https://semver.org): before 1.0, a minor version may
include breaking changes, always called out in the changelog.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE)
that covers the project.
