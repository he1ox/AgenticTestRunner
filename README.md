# qa-runner

[![skills.sh](https://skills.sh/b/he1ox/AgenticTestRunner)](https://skills.sh/he1ox/AgenticTestRunner)
[![ci](https://github.com/he1ox/AgenticTestRunner/actions/workflows/ci.yml/badge.svg)](https://github.com/he1ox/AgenticTestRunner/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/he1ox/AgenticTestRunner/badge)](https://scorecard.dev/viewer/?uri=github.com/he1ox/AgenticTestRunner)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**What you want tested, run by browser agents and signed off by you.**
([website](https://he1ox.github.io/AgenticTestRunner/))

qa-runner is a set of agent skills for the coding agent you already use: Claude Code, Codex,
Cursor, Gemini CLI, OpenCode, GitHub Copilot CLI and others. Tell it what to test, one flow or
the whole app, and point it at whatever describes it: a ticket, a spec, a pull request or a
sentence in chat. It drafts the test cases for your approval, runs each one in a real browser,
and backs every verdict with marked screenshots and a recording. You approve or reject each
result. Every case you approve is saved as a script that replays later without an agent, at $0
in tokens.

```bash
npx skills add he1ox/AgenticTestRunner
```

Then ask your agent to "test the checkout flow with a coupon", or "run the test cases for
SHOP-42".

![Human in the loop: you approve the plan, orchestrate the Test Agents, answer their questions, review the evidence and approve what they learn. Each answer, script and rule you approve makes the system work more like you.](docs/human-in-the-loop.gif)

## Built for the person who signs off the release

You test a web app by hand: log in, click through each step, compare what you see with the
expected result, take screenshots, paste them into a ticket or a report, and do it all again
next release. qa-runner does the clicking and the screenshots, and leaves every verdict to you.

Test as narrowly or as broadly as the moment needs: the one case a bug fix touches, a feature
before you hand it off, or a regression pass over the whole app before a release. The agents
work the way your project does. They test with your variants (device, role, plan tier), your
accounts and the agent and model you already use, and every answer and rule you approve is
reused by later runs.

It fits QA engineers and QA leads who run manual or exploratory test plans, developers who
verify their own work, and anyone who wants evidence that their app works before they ship it.
If your team writes and maintains a Playwright suite as code, read
[how it compares](#how-it-compares) first.

## Every verdict comes with proof

For each expected result the Test Agent takes a screenshot and marks what it checked: boxes,
arrows, numbered steps, text legends, blur for personal data, spotlight. With recording on, it
records the tab while it tests and saves an MP4 with the dead air cut.

The marks live in a JSON file next to the image, so the pixels stay untouched. In the viewer you
add your own marks, switch them off to see the raw screenshot, or export a flattened PNG for a
bug report. A replay redraws the same marks.

Before anyone sees a verdict, `validate` checks the run against the result contract. It flags
missing evidence, failures the agent didn't explain, missing recordings and credentials that
leaked into the output.

![Evidence: the Test Agent records the tab while it tests, measures elements from the DOM, takes a screenshot and marks it with a box, an arrow, numbered steps, a text legend, blur and spotlight; a reviewer adds a mark, toggles marks off to see the raw pixels and exports a PNG.](docs/evidence-and-marks.gif)

## You step in where judgment matters

Agents do the repetitive work. You make four decisions, and each one is reused by later runs:

1. **Approve the plan.** `write-test-plan` turns what you asked for (a ticket, a spec, a pull
   request or your own words) into `.qa/plans/<KEY>.plan.json` and shows you the case list
   before anything runs.
2. **Answer questions.** When an agent needs a value it doesn't have, such as an approver account
   or a coupon code, it asks in the viewer and waits. Tick "Remember" and later runs in the same
   situation reuse your answer.
3. **Review each result.** Approve, Needs retest or Reject, with a per-case chat to ask the agent
   what it saw. A retest reruns only the cases you rejected.
4. **Approve what agents learn.** After a run, agents propose lessons about your app. Nothing is
   reused until you approve it, and secrets are stored only as `env:NAME` references.

Commit `.qa/memory/` and your team shares what the agents learned. The more you approve, the
less often they need to ask.

## Agents run a case once, and your approvals replay for free

Every case an agent passes is saved as a script, read from the browser server's call log at no
extra cost: the same steps, the same annotated screenshots, the same recording. In the viewer's
**Tests** view you group scripts into Test plans ("Release 1.0.1", tags `smoke`, `regression`)
and press **Run**. Each script replays in its own headless browser with no agent, and the run
shows up like any other, marked Deterministic, at $0. When a replay fails because the UI changed
on purpose, **Repair with agent** re-records only that case.

A Test plan can gate your pipeline. `suite run <id> --ci` replays headless, writes a JUnit
report and exits 1 when a case fails, so a regression blocks the merge
([Run in CI](#run-in-ci)). When your team would rather own the tests as code, `export` writes
each script as a standard Playwright Test file that runs with `npx playwright test`
([Export to Playwright](#export-to-playwright)).

The agent runs are sized to stay cheap. `init` splits the plan into batches and gives each a tier
and effort. In Claude Code, short read-only cases run on Haiku, cases that change data or need
judgment run on Sonnet, and any failure Haiku reports is rerun on Sonnet before you see it. Each
case's brief is about 1.5 KB, and the Test Agent's prompt holds only the testing rules. With the
Claude Code plugin, up to three batches run at once, each in its own isolated browser, with one
account each when your app allows only one session per user.

The viewer opens on a dashboard of how your agents are doing: pass rate, failures, blocked cases,
agent time per case (excluding time spent waiting on you), reviewer agreement, questions asked,
and cost per run. Cost is the API list-price equivalent, exact from agent transcripts, and "n/a"
when the harness reports no usage or the model has no price. Filter by date range and plan.

## How it compares

- **Playwright Test Agents** (planner, generator, healer) write and repair `.spec.ts` files.
  Choose them if your team wants test code to own and maintain. qa-runner starts earlier: you
  describe what to test in plain language, and it runs those cases and gives you evidence to
  sign off on. The cases you approve
  can then be exported as `.spec.ts` files, so the two work together.
- **AI testing platforms** such as Momentic, QA Wolf and testRigor run your tests on their
  platform under a subscription. qa-runner runs on your machine with the agent and model you
  already pay for, and keeps plans, evidence and memory as files in your repository.
- **General browser agents** such as browser-use or gstack's `/qa` explore an app and report what
  they found. qa-runner adds what a sign-off needs: an approved plan, an evidence check before any
  verdict, review per case and a retest of what you reject.

## How a run works

```
plan.json ──init──▶ brief.md per case ──Test Agent (browser)──▶ result.json + evidence/
   ▲                                                                   │
   └──── retest ◀── review.json ◀── viewer (human review) ◀── validate
```

The orchestration is a Node CLI with no npm dependencies. Your agent launches what it prints:
Test Agents start as your agent's own subagents, or run inline when it has none. The browser is
[Playwright MCP](https://github.com/microsoft/playwright-mcp) at a pinned version with an
isolated profile.

Plans are data. Test cases, steps, variants and guardrails live in a JSON plan you can review in
a pull request. Optionally, each case is compared against a second app (legacy, production, a
design) and the deviations are reported.

| Skill | Use it to |
|---|---|
| [`qa-setup`](skills/qa-setup/SKILL.md) | Prepare a project once: check Node/npx/ffmpeg, register the browser, write `.qa/config.json` |
| [`write-test-plan`](skills/write-test-plan/SKILL.md) | Turn a ticket, a spec or a request in chat into `.qa/plans/<KEY>.plan.json` and get the case list approved |
| [`run-test-plan`](skills/run-test-plan/SKILL.md) | Run the plan with browser agents, open the viewer, retest what a reviewer rejects |
| [`replay-test-plan`](skills/replay-test-plan/SKILL.md) | Replay saved Test plans without an agent, repair stale scripts |

Install all four: the last three call the CLI that lives in `run-test-plan`.

## Requirements

- An agent that runs shell commands and MCP tools
- Node.js 20+ (no npm dependencies); installing with `npx skills add` needs Node.js 22.20+ for the installer itself
- `npx` on the PATH, for the browser ([Playwright MCP](https://github.com/microsoft/playwright-mcp))
- `ffmpeg` on the PATH, only for recordings

## Install

**Any agent, with the [skills CLI](https://github.com/vercel-labs/skills):**

```bash
npx skills add he1ox/AgenticTestRunner
```

It detects your agents and installs the four skills for each (`-a codex -a cursor` to choose,
`-g` for every project, `--list` to see them first). Then register the browser once: ask your
agent to "set up qa-runner" (the `qa-setup` skill), or run
`node <skills folder>/run-test-plan/scripts/qa-runs.mjs doctor --harness <your agent>`, which
prints the exact command for your agent.

**Or as a plugin, which also registers the browser for you.** Pick one install per agent, plugin
or `npx skills`, not both, or every skill shows up twice.

| Agent | Install |
|---|---|
| Claude Code | `claude plugin marketplace add he1ox/AgenticTestRunner`, then `claude plugin install qa-runner@AgenticTestRunner` (adds the 3-browser pool and dedicated Test Agents) |
| Codex | `codex plugin marketplace add he1ox/AgenticTestRunner`, then install `qa-runner` from `/plugins` |
| GitHub Copilot CLI | `copilot plugin install he1ox/AgenticTestRunner` |
| Cursor | install from the repository URL as an Agent Plugin (`plugin.json` + `mcp.json` at the root) |
| Gemini CLI | `gemini extensions install https://github.com/he1ox/AgenticTestRunner` |
| VS Code | **Chat: Install Plugin From Source** with the repository URL |
| OpenCode, others | `npx skills add`, then register the browser as above |

What works where:

| | Claude Code plugin | Any other install |
|---|---|---|
| Plans, runs, viewer, review, retest, memory, questions | yes | yes |
| Parallel batches (3 isolated browsers) | yes | one at a time |
| Model per tier (Haiku, escalation to Sonnet) | yes | session model, or `execution.tiers` |
| Script library (passing cases saved as replayable scripts) | yes | yes, from the browser server's call log |
| Cost per run | exact, from transcripts | from reported tokens priced by `config.pricing`, else "n/a" |
| Viewer chat | `claude -p` | the harness's headless CLI (`codex exec`, `gemini -p`, `opencode run`, `copilot -p`); none for Cursor |

Per-agent details: [`references/harness/`](skills/run-test-plan/references/harness/).

### Claude Code plugin, step by step

```bash
claude plugin marketplace add he1ox/AgenticTestRunner
```

```bash
claude plugin install qa-runner@AgenticTestRunner
```

Restart Claude Code so the skills load. `claude plugin list` should show
`qa-runner@AgenticTestRunner` enabled, and `claude mcp list` the servers `qa-browser-1..3` once a
session has started. Call a skill directly with `/qa-runner:run-test-plan`. To update:
`claude plugin marketplace update AgenticTestRunner`, then
`claude plugin update qa-runner@AgenticTestRunner`.

This repository ([he1ox/AgenticTestRunner](https://github.com/he1ox/AgenticTestRunner)) is its
own plugin marketplace, named `AgenticTestRunner`; the plugin is `qa-runner`. If you installed the
upstream plugin from the `jorgeebits/qa-runner` marketplace, uninstall it first with
`claude plugin uninstall qa-runner@qa-runner`: both register the same agents and browser tools.

Optional, for recordings: install `ffmpeg` (`winget install Gyan.FFmpeg`, `brew install ffmpeg`
or `sudo apt install ffmpeg`).

## Set up a project

Ask your agent to "set up qa-runner" (the `qa-setup` skill), or create `.qa/config.json` in the
project you test yourself (every field is optional; see
`skills/run-test-plan/schemas/config.schema.json`):

```json
{
  "harness": "codex",
  "tracker": { "name": "GitHub", "issueUrl": "https://github.com/org/repo/issues/{key}" },
  "targets": { "app": "New checkout", "reference": "Legacy checkout" },
  "variants": { "device": { "label": "Device", "values": ["desktop", "mobile"] } },
  "capabilities": { "login": "my-app-login" },
  "execution": {
    "sessions": "exclusive",
    "accounts": [
      { "user": "qa-user-01", "secret": "env:QA_PASS_1" },
      { "user": "qa-user-02", "secret": "env:QA_PASS_2" }
    ]
  }
}
```

`execution` controls speed and cost. With `sessions: "exclusive"` (the default, for apps where a
new login ends the user's other sessions) each batch running at the same time needs its own
account, so two accounts mean two browsers at once; with only the plan's login, batches run one
at a time. Use `"shared"` when one user may be logged in from several browsers. `tiers`,
`maxCasesPerAgent`, `maxParallel` and `escalate` tune the routing; see
`skills/run-test-plan/schemas/config.schema.json`. Passwords stay in environment variables.

Add `.qa/runs/` to `.gitignore`. Commit `.qa/memory/` to share what agents learned with your
team, and `.qa/tests/` and `.qa/suites/` (the test library and Test plans). `examples/` holds a
complete config, plan and memory.

## Use

Ask your agent to test something ("test the refund flow as an approver", "run the test plan for
SHOP-42", "corre los test cases"). The
skills draft or reuse `.qa/plans/<KEY>.plan.json`, ask you to approve the cases, run them, and
open the viewer at `http://127.0.0.1:4321`.

The CLI also works on its own:

```bash
node skills/run-test-plan/scripts/qa-runs.mjs doctor --harness codex
node skills/run-test-plan/scripts/qa-runs.mjs init .qa/plans/SHOP-42.plan.json --label smoke --harness codex
node skills/run-test-plan/scripts/qa-runs.mjs open
node skills/run-test-plan/scripts/qa-runs.mjs next <runId>
node skills/run-test-plan/scripts/qa-runs.mjs validate <runId>
node skills/run-test-plan/scripts/qa-runs.mjs profile ~/.claude/projects/<project>/*/subagents/*.jsonl
node skills/run-test-plan/scripts/qa-runs.mjs memory --help
```

`profile` shows where agents' tokens went (context size per turn, tool results by tool), from any
transcripts, so you can measure a change against earlier runs.

| Variable | Default | Purpose |
|---|---|---|
| `QA_PROJECT_DIR` | current directory | Project whose `.qa/` folder is used |
| `QA_HARNESS` | detected, else `generic` | Agent harness, when `.qa/config.json` and `--harness` don't say |
| `QA_RUNS_DIR` | `.qa/runs` | Where runs are written |
| `QA_VIEWER_PORT` | `4321` | Viewer port |
| `QA_CHAT_HARNESS` | project's harness | CLI behind the viewer's agent chat: `claude`, `codex`, `gemini`, `opencode`, `copilot` |
| `QA_CHAT_BIN` | that CLI | Binary the chat runs (`QA_CLAUDE_BIN` is the old name, for `claude`) |
| `QA_CHAT_MODEL` | `sonnet` (Claude), else the CLI's default | Model behind the viewer's agent chat |
| `QA_CHAT_EFFORT` | `low` | Effort for the viewer's agent chat |
| `QA_PLAYWRIGHT_MCP` | `@playwright/mcp@0.0.82` | Playwright MCP package the browser pool runs |
| `QA_BROWSER_ARGS` | none | Extra Playwright MCP flags for every browser, e.g. `--headless` |
| `QA_USER_MEMORY_DIR` | `~/.qa/memory` | Personal memory folder |
| `QA_PASSWORD` | none | Password deterministic replays type when the account has no `secret` |
| `QA_REPLAY_DEBUG` | off | Print every action a deterministic replay sends and the browser's reply |

### Test plans from the terminal

Everything the **Tests** and **Test plans** views do is also a command:

```bash
node skills/run-test-plan/scripts/qa-runs.mjs tests --tag smoke
node skills/run-test-plan/scripts/qa-runs.mjs suite create "Release 1.0.1" --tags smoke,regression --tag smoke
node skills/run-test-plan/scripts/qa-runs.mjs suite run release-1.0.1
```

Scripts type the login password from the account's `env:NAME` secret or `QA_PASSWORD`, so start
the viewer from a shell that has them. See the
[`replay-test-plan`](skills/replay-test-plan/SKILL.md) skill.

### Run in CI

`--ci` turns a Test plan into a pipeline gate. It runs with no viewer window and no agent,
prints a line per case and the totals, and exits 0 when everything passed, 1 when a case failed
and 2 when the run could not start.

```bash
node skills/run-test-plan/scripts/qa-runs.mjs suite run smoke --ci --junit qa-junit.xml
```

- `--fail-on fail|blocked|fail,blocked|none` picks which statuses fail the job. The default is
  `fail,blocked`, since a blocked case (no login, a removed script) proved nothing.
- `--junit <path>` writes a JUnit report: one testsuite for the plan, one testcase per case,
  the failure from the result, and evidence paths as `attachment` properties and
  `[[ATTACHMENT|…]]` lines. With `--ci` it is always written, by default to
  `.qa/runs/<run>/junit.xml`.
- Every password the plan types must be in the environment (`env:NAME` secrets or
  `QA_PASSWORD`). A missing one stops the job before a browser starts, and the error names the
  variable.
- Without ffmpeg, recordings are skipped with a warning. Screenshots and marks still replay.
- `replay <runId> --ci` does the same for a run the viewer prepared.

[`examples/ci/qa-replay.yml`](examples/ci/qa-replay.yml) is a GitHub Actions workflow that
runs a plan, uploads `.qa/runs/` as an artifact and publishes the JUnit report as a check.

### Export to Playwright

The library is plain JSON. When your team wants to run, review and own the tests as code,
`export` writes them as standard [Playwright Test](https://playwright.dev/docs/intro) files:

```bash
node skills/run-test-plan/scripts/qa-runs.mjs export --tag smoke --out e2e/qa --config
npx playwright test --grep @smoke
```

Each script becomes `e2e/qa/<plan>/<tc>.spec.ts`, and a plan group that shares one browser
session becomes one serial file. The login turns into a `beforeEach` that reads the password
from `process.env`, so it is never written to the file. Each plan step becomes a `test.step`,
the recorded Playwright code is kept as it is, and every screenshot mark becomes a
`toBeVisible()` assertion with the screenshot attached to the report. Anything that can't be
translated is left as a `// TODO(qa-runner)` comment.

Select tests by id, `--tag`, `--suite` or `--plan`. The same scripts always produce the same
files, and a file you edited is only replaced with `--force`. `--config` adds a
`playwright.config.ts` when the project has none. The viewer's **Tests** view has the same
action for the tests its filters show. Your project needs `@playwright/test`; qa-runner itself
still has no npm dependencies.

## Contribute

Contributions are welcome: bug reports, docs, support for another harness, or code. Start with
[CONTRIBUTING.md](CONTRIBUTING.md); [AGENTS.md](AGENTS.md) maps the repository and its rules. In
short: no npm dependencies, generated files come from `node scripts/build.mjs`, and
`node scripts/check.mjs` runs every check CI runs (spec validation, generated files, syntax and
the `node:test` suite). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

Questions go to [Discussions](https://github.com/he1ox/AgenticTestRunner/discussions),
vulnerabilities to a [private report](SECURITY.md). Everyone taking part follows the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## License

[MIT](LICENSE)
