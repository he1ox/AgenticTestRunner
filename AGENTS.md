# Working on qa-runner

Guidance for coding agents (and humans) changing this repository. Users of the skills don't
need it: they read `skills/*/SKILL.md`.

## Layout

- `skills/` — the four skills, one folder each, following the
  [Agent Skills spec](https://agentskills.io/specification). `run-test-plan` owns the CLI
  (`scripts/qa-runs.mjs`), the viewer and the schemas; the other three call that CLI through
  `../run-test-plan/scripts/qa-runs.mjs`, so they install together.
- `skills/run-test-plan/scripts/harness.mjs` — everything that differs per agent harness
  (Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Copilot, generic). Keep harness checks
  there and in `references/harness/*.md`, not spread through the scripts.
- `claude/agents/`, `.claude-plugin/`, `plugin.json` + `mcp.json` (Agent Plugins 1.0),
  `.codex-plugin/`, `.agents/plugins/`, `gemini-extension.json` — packaging per harness. All but
  the metadata in `.claude-plugin/plugin.json` are **generated**.
- `examples/.qa/` — a complete project config, plan and memory, used by CI and the tests.
- `test/` — the `node:test` suite (`node --test`). Import `./setup-project.mjs` first in every
  test file: it points the scripts at a temporary copy of `examples/.qa`.
- `scripts/check.mjs` — every check CI runs, in one command.

## Rules

- Never edit generated files by hand. Change `skills/run-test-plan/scripts/agents.mjs` (Test
  Agent rules, browser servers) or the metadata in `.claude-plugin/plugin.json`, then run
  `node scripts/build.mjs`.
- Change the version only with `node scripts/bump-version.mjs <x.y.z>` and add a
  `CHANGELOG.md` entry.
- No npm dependencies, anywhere. Node 20+ built-ins only.
- A skill's `SKILL.md` stays under 500 lines and loads its references just in time; every path
  it names must exist (`validate-skills.mjs` checks).
- Contracts (`schemas/*.json`) are read by older runs: bump `schemaVersion` and keep reading the
  old shape when one changes.
- Nothing a harness-neutral skill says may assume one harness's tool names; put those in
  `references/harness/<name>.md`.

## Before you open a PR

```bash
node scripts/check.mjs
```

It validates the skills, checks generated files, parses every script and JSON file and runs the
tests; CI runs the same on Linux, Windows and macOS with Node 20, 22 and 24. Add or update tests
in `test/` for behavior you change. PR titles follow Conventional Commits (`type(scope): summary`);
a check enforces it. See [CONTRIBUTING.md](CONTRIBUTING.md).

Then install from your checkout into a scratch project and run the example plan with the
harness you changed: `npx skills add <path-to-checkout> -a <agent> --copy`.
