# Changelog

## Unreleased

- **Open to contributions.** `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1),
  `SECURITY.md` (private vulnerability reports), `SUPPORT.md`, issue forms, a pull request
  template, `CODEOWNERS`, `.editorconfig` and `.gitattributes` (LF in every checkout).
  `docs/open-source-checklist.md` tracks what is in place and what is left.
- **Tests and one check command.** A `node:test` suite in `test/` (contracts, JUnit, pricing,
  harnesses, annotations, the literal parser, scheduling, and the CLI end to end for every
  harness) and `node scripts/check.mjs`, which runs everything CI runs.
- **Stronger CI.** Checks run on Linux, Windows and macOS with Node 20, 22 and 24, plus
  actionlint and the skills CLI, behind one required `ci ok` job. New workflows: Conventional
  Commit PR titles, CodeQL, dependency review, OpenSSF Scorecard, and releases published from
  `CHANGELOG.md` when a `v*` tag is pushed. Every action is pinned to a commit SHA and kept
  current by Dependabot.
- **Landing page** in `site/`: plain HTML, CSS and JS with no dependencies, published to GitHub
  Pages by `.github/workflows/pages.yml`. Three animations tell the story: agents test a shop,
  decide to take screenshots and mark them; you answer a question once, review verdicts and
  approve what agents learn; then the dashboard's insights, a chat with the agent about one
  case, a Test plan replayed deterministically at $0, and questions falling and reviewer
  agreement rising as approved memory grows. `site/llms.txt` points agents at the skills.
  `bump-version.mjs` also updates the version shown on the page.

## 0.9.0 — 2026-10-11

From sign-off to pipeline: approved cases gate CI and export as Playwright code.

- **CI mode for Test plans.** `suite run <id> --ci` (and `replay <runId> --ci`) replays
  headless with no viewer window and no agent, prints one line per case and the totals, and
  exits 1 when a case ends in a `--fail-on` status (`fail`, `blocked`, both by default, or
  `none`), 2 when the run cannot start. Missing password variables are reported up front, by
  name, before a browser starts; without ffmpeg, recordings are skipped with a warning. On
  GitHub Actions each gating case is also an `::error` annotation. The logic lives in
  `scripts/ci.mjs`.
- **JUnit reports.** `--junit <path>` (always written with `--ci`, by default to
  `.qa/runs/<run>/junit.xml`): one testsuite for the plan, one testcase per case, the failure
  from the result, evidence as `attachment` properties and `[[ATTACHMENT|…]]` lines.
- **Example workflow** `examples/ci/qa-replay.yml`: run a plan on GitHub Actions, upload the run
  folder, publish the JUnit report as a check.
- **Export to Playwright.** `qa-runs.mjs export [<PLAN/TC>…] [--tag t] [--suite id] [--plan P]
  [--out e2e/qa] [--force] [--config]` writes library scripts as standard Playwright Test files
  (`<out>/<plan>/<tc>.spec.ts`; a plan group is one serial file sharing a page) that run with
  `npx playwright test`. The login becomes a `beforeEach` reading the password from
  `process.env`, steps become `test.step`, recorded code is kept, target-app URLs go through
  `BASE_URL` (`QA_BASE_URL`), and screenshot marks become `toBeVisible()` assertions with the
  screenshot attached; anything else is a `// TODO(qa-runner)` comment. Output is
  deterministic, edited files are kept unless `--force`, and `--config` adds a
  `playwright.config.ts` only when none exists. The viewer's Tests view has an
  **Export to Playwright** button for the filtered tests (`POST /api/tests/export`).
- **README** rewritten around who signs off a release: evidence for every verdict, the four
  decisions a human makes, approved cases replaying for free, and how qa-runner compares with
  Playwright Test Agents, AI testing platforms and general browser agents.

## 0.8.0 — 2026-10-11

Harness parity: what was Claude Code only now works with every agent.

- **Recording browser proxy.** `browser-mcp.mjs` sits between the agent and Playwright MCP,
  relays everything, and appends each tool call with the text of its reply (no images) to
  `<tmpdir>/qa-browser-<slot>/calls.jsonl`.
- **Test library without transcripts.** `usage --batch <id>` saves passing cases as replayable
  scripts from that log, cut to the batch's time window and split per case by `mark … running`
  and each result.json; `--transcript` (Claude Code) still takes precedence and behaves as
  before. Browser tools are recognised under any harness's prefix (`…browser_*`).
- **Neutral costs.** A model with no known price costs "n/a" in the CLI and the dashboard,
  never another model's price; `usage --input N --output N [--cached N] --model id` prices any
  harness's reported usage through `.qa/config.json → pricing` (also keyed `provider/model`).
  A batch closed with no usage is recorded as "not reported" with a browser-call profile.
- **Pluggable viewer chat.** One adapter per headless CLI: `claude -p`, `codex exec`,
  `gemini -p`, `opencode run`, `copilot -p`, chosen by the project's harness or
  `QA_CHAT_HARNESS`; `QA_CHAT_BIN` (with `QA_CLAUDE_BIN` as the old name). Cursor and generic
  have none, and a missing CLI disables the drawer with the reason. On Windows, npm CLI shims
  run without a shell.

## 0.7.0 — 2026-10-11

Any coding agent can now install and run qa-runner, not only Claude Code.

- **Install with `npx skills add he1ox/AgenticTestRunner`** into Claude Code, Codex, Cursor,
  Gemini CLI, OpenCode, Copilot CLI and the other agents the
  [skills CLI](https://github.com/vercel-labs/skills) supports.
- **Plugins per harness**, generated from one source by `scripts/build.mjs`: Claude Code
  (`.claude-plugin/`), Agent Plugins 1.0 (`plugin.json` + `mcp.json`: Codex, Cursor, Copilot,
  VS Code), Codex (`.codex-plugin/`, `.agents/plugins/marketplace.json`) and Gemini CLI
  (`gemini-extension.json`).
- **Four composable skills** instead of one: `qa-setup` (new: onboarding and browser
  registration), `write-test-plan` (was `run-test-plan/references/plan.md`), `run-test-plan`,
  and `replay-test-plan` (Test plans and repairs, was part of `references/library.md`).
- **Harnesses.** `init --harness <name>` (or `.qa/config.json → harness`, `QA_HARNESS`;
  Claude Code is detected). Outside the Claude Code plugin, batches run one at a time on a shared
  `qa-browser` server with the Test Agent rules in the prompt, or inline from
  `references/test-agent.md`. Per-harness launch guides in `references/harness/`.
- **Tiers instead of model names.** Claude Code keeps haiku/sonnet; other harnesses run on the
  session model unless `execution.tiers` names one. Escalation applies only when tiers use
  different models.
- New commands: `doctor` (prerequisites and the exact browser registration for your harness,
  `--browser` to start it once) and `init --check` (validate a plan without creating a run).
  `usage --batch <id>` alone closes a batch when the harness reports no tokens.
- Personal memory moved to `~/.qa/memory/` (an existing `~/.claude/qa-memory/` keeps working).
  Capabilities are found in `.agents/skills`, `.cursor/skills`, `.gemini/skills`… as well as
  `.claude/skills`.
- Claude Code's Test Agents moved from `agents/` to `claude/agents/` (Gemini CLI and Cursor
  load an `agents/` folder as their own subagents). `scripts/build-agents.mjs` is now
  `scripts/build.mjs`.
- Quality: `scripts/validate-skills.mjs` (Agent Skills spec, paths, versions),
  `scripts/bump-version.mjs`, GitHub Actions CI, `AGENTS.md` for contributors.

Still Claude Code only in 0.7.0: saving passing cases as replayable scripts (reads Claude Code
transcripts), exact cost per run, and the viewer's agent chat (`claude -p`). See 0.8.0.
