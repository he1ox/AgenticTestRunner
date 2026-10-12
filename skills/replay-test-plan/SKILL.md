---
name: replay-test-plan
description: Use when asked to run a saved Test plan or suite of recorded QA tests without an agent ("run the smoke suite", "corre el plan de regresión", "replay Release 1.0.1"), to group library tests into Test plans, or to repair a recorded test whose replay failed because the UI changed. Deterministic runs, no model and no tokens.
license: MIT
compatibility: Part of qa-runner; needs the run-test-plan skill installed alongside. Node.js 20+ and npx (Playwright MCP); ffmpeg only for recordings.
metadata:
  author: jorge.lopezg
  version: "0.9.0"
---

# Replay Test Plan

Every case a Test Agent **passes** is saved as a script in `.qa/tests/` (how:
`../run-test-plan/references/library.md`). People group those scripts into **Test
plans** (a name such as "Release 1.0.1", their own tags such as `smoke` or `regression`, and the
tests to run) and run them deterministically: no model, no tokens, the same actions every time.
Runs land in `.qa/runs/` and open in the same viewer.

`$Q` means `node <the folder holding this SKILL.md>/../run-test-plan/scripts/qa-runs.mjs`, run
from the project root. If that file does not exist, ask the human to install the full set:
`npx skills add he1ox/AgenticTestRunner`.

## Test plans (suites)

The viewer's **Test plans** view creates them; the CLI does the same:

```
$Q suite create "Release 1.0.1" --tags smoke,regression [--tag smoke] [--tests SHOP-42/TC-1,…]
$Q suite add <id> SHOP-42/TC-3 [--tag regression]      $Q suite remove <id> SHOP-42/TC-3
$Q suite show <id>   $Q suite list   $Q suite delete <id>
$Q tests [--tag smoke]   $Q tests tag <PLAN/TC> a,b   $Q tests verify <PLAN/TC>
```

## Deterministic runs

**Run** in the viewer, or `$Q suite run <id> [--headed]`, replays every test of the plan:

- each source group runs in its own fresh Playwright MCP browser (the same pinned package as the
  agents, headless unless `--headed`), setup once, then its tests in recorded order;
- every capture is retaken with the same file name and marks, and a mark whose element is not on
  the page **fails the step** (the marks are the assertions); recordings start and stop where
  they did;
- the run lands in `.qa/runs/<suite>_<stamp>/` like any other, marked Deterministic, at $0.

Passwords come from the account's `secret` (`env:NAME` in `.qa/config.json → execution.accounts`)
or `QA_PASSWORD`; without one, a test that types a password ends `blocked` and says which variable to set. The
viewer server passes on its own environment, so start it (`$Q open`) from a shell that has them.
`execution.replayTimeoutMs` (default 15000) is how long an action waits for its element and
`execution.replayNavigationTimeoutMs` (default 60000) how long a page may take to load.

In CI, add `--ci`: headless, no viewer, a line per case, a JUnit report (`--junit <path>`,
default `.qa/runs/<run>/junit.xml`) and exit code 1 when a case ends in a `--fail-on` status
(`fail,blocked` by default; `fail`, `blocked` or `none`), 2 when it cannot start (unknown
plan, or a password variable missing: checked before any browser opens). No ffmpeg skips
recordings only. Example workflow: `examples/ci/qa-replay.yml` in the qa-runner repository.

Groups run one at a time unless `execution.sessions` is `shared`. A test recorded right after
another case of the same agent session, with no separate login, may depend on it: the run warns
when the plan leaves that case out.

## When a replay fails

The case is `fail` with the step, Playwright's error and a `NN-failure.png`. Either the product
regressed (review it like any failure) or the UI changed on purpose and the script is stale:
**Repair with agent** in the viewer (or `$Q heal <runId> <tcId>`) creates a one-case run briefed
from the original steps and the failure. Execute it with the **run-test-plan** skill's normal loop (`next` → launch → `usage --batch`);
when the agent passes, its script becomes the next version of the same test.

## Export to Playwright

When the team wants the tests as their own Playwright code (CI they already run, SDETs who
review `.spec.ts`), export them; the library stays the source for qa-runner's own runs:

```
$Q export [<PLAN/TC>…] [--tag smoke] [--suite <id>] [--plan SHOP-42] [--out e2e/qa] [--force] [--config]
```

- One `<out>/<plan>/<tc>.spec.ts` per script; a plan group (one browser session) is one serial
  file. No selector exports the whole library. Then `npx playwright test` (the project needs
  `@playwright/test`).
- Login → `beforeEach` with `process.env.<NAME>` for the account's `env:NAME` secret
  (`QA_PASSWORD` otherwise); steps → `test.step`; recorded code as is, with URLs of the
  target app behind `BASE_URL` (`QA_BASE_URL`); each mark → `expect(…).toBeVisible()`;
  untranslatable actions and captures without marks → `// TODO(qa-runner)` comments.
- Same scripts, same bytes. A file that differs (edited by hand) is skipped unless `--force`;
  `--config` writes `playwright.config.ts` only if the project has no Playwright config.

## Limits

- Data that must be unique per run (a name created twice) can fail on replay; edit the value in
  the test's JSON or record the case again.
- Network and JSON evidence the agent saved with Write is not replayed; screenshots, marks and
  videos are.

## Related skills

- **run-test-plan**: records the scripts in the first place, and executes repair runs.
- **write-test-plan**: a new case starts as a plan, not as a hand-written script.
