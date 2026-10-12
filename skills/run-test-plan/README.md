# run-test-plan

> Run manual-style E2E test plans with browser agents, review each case's result and evidence in a local viewer, and retest only what a reviewer rejects.

## What it does

The skill turns a test ticket or test plan into `.qa/plans/<KEY>.plan.json`, asks you to approve the case list, then schedules batches of cases with a tier and effort each (in Claude Code: Haiku for short read-only cases, Sonnet for the rest, Haiku failures re-checked on Sonnet) and launches Playwright-driven Test Agents through your agent's own subagents, or runs them inline when it has none. With the Claude Code plugin's browser pool and enough test accounts, several run at once. Agents write a result and evidence (screenshots, optional video) per case. A local viewer at `http://127.0.0.1:4321` shows live progress, a dashboard (pass rate, blocked cases, agent time, cost per run), screenshot annotations, and Approve / Needs retest / Reject buttons. `validate` checks every result for missing evidence and leaked credentials before anyone trusts a verdict. Agents can ask you questions through the viewer; approved answers are remembered for later runs (secrets only as `env:NAME` references).

## When to use it

- Executing the test cases of a ticket against a QA / non-prod web app
- Rerunning only the cases a reviewer marked for retest
- Comparing a new app against a reference (legacy app, design) case by case
- Reopening the viewer for a previous run

## How to invoke

```
/run-test-plan
run the test plan for SHOP-42
corre los test cases de SHOP-42
retest the rejected cases from the last run
```

## Example

**Invoke:**
```
Run the test cases for SHOP-42 on QA, with recording
```

**What happens:**

1. Drafts or reuses `.qa/plans/SHOP-42.plan.json` and asks you to approve the case list
2. Runs `qa-runs.mjs init` and opens the viewer
3. Launches the Test Agents that `qa-runs.mjs next` lists; each case gets `result.json` + evidence
4. Runs `validate` and flags contract warnings or credential leaks
5. You review in the viewer; `init --retest <runId>` reruns exactly the rejected cases

## Setup

- Any agent that runs shell commands: Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Copilot CLI… (`references/harness/`)
- Node.js 20+ (no npm dependencies)
- A browser server: installed as a plugin or extension it comes registered; otherwise `node scripts/qa-runs.mjs doctor --harness <yours>` prints the one command to register it (the **qa-setup** skill walks you through it)
- `ffmpeg` on the PATH, only for recordings
- Optional per-project settings in `.qa/config.json` (see `schemas/config.schema.json`). Add `.qa/runs/` to `.gitignore`.
- Credentials are never stored: pass them in the agent prompt or as `env:NAME` references.

## Installation

```bash
npx skills add he1ox/AgenticTestRunner
```

That installs this skill and its companions (`qa-setup`, `write-test-plan`, `replay-test-plan`)
for the agents it detects. Plugin installs per agent are in the
[repository README](https://github.com/he1ox/AgenticTestRunner#install).

Source and issues: https://github.com/he1ox/AgenticTestRunner

## Metadata

| Field | Value |
|-------|-------|
| Author | @jorgeebits |
| Version | 0.8.0 |
| Last updated | 2026-10-11 |
| Target Project | Any web app — QA / non-prod |
