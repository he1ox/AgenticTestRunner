# qa-runner

A Claude Code plugin that runs manual-style end-to-end test plans with browser agents, shows the
results in a local viewer, and reruns only the cases a human rejects.

```
plan.json ──init──▶ brief.md per case ──Test Agent (browser)──▶ result.json + evidence/
   ▲                                                                   │
   └──── retest ◀── review.json ◀── viewer (human review) ◀── validate
```

- **Plans as data.** Test cases, steps, variants and guardrails live in a JSON plan.
- **Dedicated Test Agents.** The plugin ships Test Agents whose prompt holds only the testing
  rules and whose tools are only Read, Write, Bash and their own browser, so each agent starts
  small and every case's brief is about 1.5 KB.
- **Parallel and right-sized.** `init` splits the plan into batches and picks a model and effort
  per batch: short read-only cases go to Haiku, cases that change data or need judgment go to
  Sonnet. Any failure Haiku reports is re-run on Sonnet before you see it. Up to three batches
  run at once, each in its own isolated browser, with one account each when your app allows
  only one session per user.
- **Contract checks.** `validate` flags missing evidence, unexplained failures, missing
  recordings and leaked credentials before anyone trusts a verdict.
- **Dashboard.** The viewer opens on how your agents are doing: pass rate, failures, blocked
  cases, average agent time per case (excluding time waiting on you), reviewer agreement and
  questions asked, plus cost per run (API list-price equivalent, exact from agent
  transcripts), with outcomes by run and by variant, cases that need attention, the slowest
  cases, and your recent runs. Filter by date range and plan.
- **Local viewer.** Live progress, screenshots with non-destructive marks (arrows, boxes,
  spotlight, blur), recordings, a per-case agent chat, and Approve / Needs retest / Reject.
- **Reference comparison.** Optionally compare each case against another app (legacy,
  production, a design) and report deviations.
- **Test library and Test plans.** Every case an agent passes is saved as a script, read from
  the agent's transcript at no extra cost: same steps, same annotated screenshots, same
  recording. In the viewer you group scripts into Test plans ("Release 1.0.1", tags `smoke`,
  `regression`…) and run them deterministically: no agent, no tokens. When a replay fails because
  the UI changed on purpose, "Repair with agent" re-records just that case.
- **Memory.** When an agent needs a value it does not have, it asks you in the viewer and waits.
  Tick "Remember" and later runs in the same situation reuse the answer. Agents also propose
  what they learned; nothing is reused until you approve it. Secrets are stored only as
  `env:NAME` references.

## Requirements

- [Claude Code](https://docs.claude.com/en/docs/claude-code)
- Node.js 20+ (no npm dependencies)
- `npx` on the PATH: the plugin starts its own pool of [Playwright MCP](https://github.com/microsoft/playwright-mcp)
  browsers (`qa-browser-1..3`, pinned version, isolated profiles)
- `ffmpeg` on the PATH, only for recordings

## Install

This fork ([he1ox/AgenticTestRunner](https://github.com/he1ox/AgenticTestRunner)) is its own
plugin marketplace. The marketplace is named `AgenticTestRunner`, after the repo, and the
plugin `qa-runner`. If you already installed the upstream plugin from the `jorgeebits/qa-runner`
marketplace, uninstall it first with `claude plugin uninstall qa-runner@qa-runner`: both register
the same agents and browser tools.

1. Add the fork as a plugin marketplace and install the plugin:

   ```bash
   claude plugin marketplace add he1ox/AgenticTestRunner
   ```

   ```bash
   claude plugin install qa-runner@AgenticTestRunner
   ```

   Inside a Claude Code session the same steps are `/plugin marketplace add he1ox/AgenticTestRunner`
   and `/plugin install qa-runner@AgenticTestRunner`. Restart Claude Code afterwards so the
   `run-test-plan` skill loads.

2. Nothing else to register: the plugin starts its browser pool and Test Agents itself. Only if
   you use the skill without the plugin (copied into `.claude/skills/`), register a Playwright
   MCP server named `playwright`; agents then run one at a time as general-purpose agents:

   ```bash
   claude mcp add playwright -- npx @playwright/mcp@0.0.82
   ```

3. Optional, for recordings: install `ffmpeg` (`winget install Gyan.FFmpeg`,
   `brew install ffmpeg` or `sudo apt install ffmpeg`) and make sure it is on the PATH.

4. Check the install with `claude plugin list` and `claude mcp list`. `qa-runner@AgenticTestRunner`
   should be listed as enabled, and `qa-browser-1..3` should appear once a session has started.

5. Use the skill from the Claude Code CLI: open `claude` in the project you want to test and
   ask for it in plain words ("run the test plan for SHOP-42"), or call it directly with
   `/qa-runner:run-test-plan` (see [Use](#use)).

To update, run `claude plugin marketplace update AgenticTestRunner` and then
`claude plugin update qa-runner@AgenticTestRunner`. To remove it, run
`claude plugin uninstall qa-runner@AgenticTestRunner`.

To work on the plugin itself, clone the fork and add the local folder instead:

```bash
git clone https://github.com/he1ox/AgenticTestRunner.git
```

```bash
claude plugin marketplace add ./AgenticTestRunner
```

## Set up a project

Create `.qa/config.json` in the project you test (every field is optional; see
`skills/run-test-plan/schemas/config.schema.json`):

```json
{
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

Add `.qa/runs/` to `.gitignore`; commit `.qa/memory/` to share what agents learned with your
team, and `.qa/tests/` and `.qa/suites/` (the test library and Test plans). `examples/` holds a complete config, plan and memory.

## Use

Ask Claude to run a test plan ("run the test plan for SHOP-42", "corre los test cases"). The
`run-test-plan` skill drafts or reuses `.qa/plans/<KEY>.plan.json`, asks you to approve the
cases, runs them, and opens the viewer at `http://127.0.0.1:4321`.

The CLI also works on its own:

```bash
node skills/run-test-plan/scripts/qa-runs.mjs init .qa/plans/SHOP-42.plan.json --label smoke
node skills/run-test-plan/scripts/qa-runs.mjs open
node skills/run-test-plan/scripts/qa-runs.mjs next <runId>
node skills/run-test-plan/scripts/qa-runs.mjs validate <runId>
node skills/run-test-plan/scripts/qa-runs.mjs profile ~/.claude/projects/<project>/*/subagents/*.jsonl
node skills/run-test-plan/scripts/qa-runs.mjs memory --help
```

| Variable | Default | Purpose |
|---|---|---|
| `QA_PROJECT_DIR` | current directory | Project whose `.qa/` folder is used |
| `QA_RUNS_DIR` | `.qa/runs` | Where runs are written |
| `QA_VIEWER_PORT` | `4321` | Viewer port |
| `QA_CHAT_MODEL` | `sonnet` | Model behind the viewer's agent chat |
| `QA_CHAT_EFFORT` | `low` | Effort for the viewer's agent chat |
| `QA_PLAYWRIGHT_MCP` | `@playwright/mcp@0.0.82` | Playwright MCP package the browser pool runs |
| `QA_BROWSER_ARGS` | none | Extra Playwright MCP flags for every browser, e.g. `--headless` |
| `QA_CLAUDE_BIN` | `claude` | Claude Code binary the chat runs |
| `QA_USER_MEMORY_DIR` | `~/.claude/qa-memory` | Personal memory folder |
| `QA_PASSWORD` | none | Password deterministic replays type when the account has no `secret` |
| `QA_REPLAY_DEBUG` | off | Print every action a deterministic replay sends and the browser's reply |

### Test plans: deterministic runs

Once agents have passed some cases, open the viewer's **Tests** view to see the library (tags,
draft or verified, last replay) and **Test plans** to create one: name it, add your tags, pick
tests (or every test with a tag) and press **Run**. The run replays each script in its own
headless browser and shows up like any other run, marked Deterministic, at $0. The same from the
terminal:

```bash
node skills/run-test-plan/scripts/qa-runs.mjs tests --tag smoke
node skills/run-test-plan/scripts/qa-runs.mjs suite create "Release 1.0.1" --tags smoke,regression --tag smoke
node skills/run-test-plan/scripts/qa-runs.mjs suite run release-1.0.1
```

Scripts type the login password from the account's `env:NAME` secret or `QA_PASSWORD`, so start
the viewer from a shell that has them. See
[`references/library.md`](skills/run-test-plan/references/library.md).

`profile` shows where agents' tokens went (context size per turn, tool results by tool), from any
transcripts, so you can measure a change against earlier runs.

## Develop

The Test Agents' rules live in `skills/run-test-plan/scripts/agents.mjs`. After changing them,
regenerate `agents/` and the browser pool in `.claude-plugin/plugin.json` with `node scripts/build-agents.mjs` (`--check` fails when
they are out of date).

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## License

[MIT](LICENSE)
