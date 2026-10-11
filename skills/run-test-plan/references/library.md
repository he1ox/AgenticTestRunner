# Test library and Test plans

Every case a Test Agent **passes** becomes a script that replays without an agent. People group
those scripts into **Test plans** in the viewer (a name such as "Release 1.0.1", their own tags
such as `smoke` or `regression`, and the tests to run) and run them deterministically: no model,
no tokens, the same actions every time.

## How a script is saved

Nothing extra is asked of the agent. Playwright MCP answers every browser tool with the
Playwright code it ran, and the agent's transcript keeps those answers. When you record a batch
(`$Q usage <run> --batch <b> --transcript <output_file> …`, step 3 of execute.md), the same call:

- splits the transcript by `mark <run> <tc> running`: what came before the first mark is the
  **setup** (the login), the rest belongs to each case;
- keeps every successful action as code, each annotated capture as `{file, marks}` and each
  recording start/stop as is; failed attempts, snapshots and finds are dropped;
- assigns actions to steps through the evidence each step reported in result.json;
- replaces the login user and password with `{{user}}` / `{{secret}}` (and any value typed into a
  password field), and refuses to save if the password still shows;
- saves `.qa/tests/<planId>/<tcId>.json` (`schemas/test-script.schema.json`) as **draft**, only
  for cases with status `pass` and no contract warnings. A newer recording becomes the next
  version; the old one moves to `.history/`. Tags edited in the viewer are kept.

It prints one `script saved: …` or `script <tc>: not saved (why)` line per case. Approving the case
in the viewer marks its script **verified**; rejecting it sets it back to draft.

Commit `.qa/tests/` and `.qa/suites/` with the project: they are reviewable code.

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
`execution.replayTimeoutMs` (default 15000) is how long an action waits for its element.

Groups run one at a time unless `execution.sessions` is `shared`. A test recorded right after
another case of the same agent session, with no separate login, may depend on it: the run warns
when the plan leaves that case out.

## When a replay fails

The case is `fail` with the step, Playwright's error and a `NN-failure.png`. Either the product
regressed (review it like any failure) or the UI changed on purpose and the script is stale:
**Repair with agent** in the viewer (or `$Q heal <runId> <tcId>`) creates a one-case run briefed
from the original steps and the failure. Execute it with the normal loop (`next` → launch →
`usage --batch`); when the agent passes, its script becomes the next version of the same test.

## Limits

- Data that must be unique per run (a name created twice) can fail on replay; edit the value in
  the test's JSON or record the case again.
- Network and JSON evidence the agent saved with Write is not replayed; screenshots, marks and
  videos are.
