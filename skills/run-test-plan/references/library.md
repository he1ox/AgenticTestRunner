# Test library

Every case a Test Agent **passes** becomes a script that replays without an agent. Grouping
scripts into Test plans, running them and repairing them is the **replay-test-plan** skill.

## How a script is saved

Nothing extra is asked of the agent. Playwright MCP answers every browser tool with the
Playwright code it ran, and two records keep those answers:

- **the browser server's call log**, with every harness: `browser-mcp.mjs` is a proxy in front
  of Playwright MCP that appends each tool call, its arguments and the text of its reply (no
  images) to `<tmpdir>/qa-browser-<slot>/calls.jsonl` (`shared` outside the Claude Code
  plugin). A browser registered some other way (plain `npx @playwright/mcp`) leaves no log;
  `$Q doctor` prints the right registration.
- **the agent's transcript**, in Claude Code (`--transcript`, references/harness/claude-code.md),
  which also gives the exact cost. When given, it is used instead of the log.

When you close a batch with `$Q usage <run> --batch <b> …` (step 3 of execute.md), the same call:

- splits what the agent did by case: what came before the first `mark <run> <tc> running` is the
  **setup** (the login), each case runs from its mark to its result.json, and anything between
  one case's result and the next case's mark belongs to the next case. From the log, only calls
  inside the batch's time window (from its `LAUNCH` to now) on its browser count;
- keeps every successful action as code, each annotated capture as `{file, marks}` and each
  recording start/stop as is; failed attempts, snapshots and finds are dropped;
- assigns actions to steps through the evidence each step reported in result.json;
- replaces the login user and password with `{{user}}` / `{{secret}}` (and any value typed into a
  password field), and refuses to save if the password still shows. From the log, the user is
  the batch's account and the password its `env:` secret or what was typed into a password field;
- saves `.qa/tests/<planId>/<tcId>.json` (`schemas/test-script.schema.json`) as **draft**, only
  for cases with status `pass` and no contract warnings. A newer recording becomes the next
  version; the old one moves to `.history/`. Tags edited in the viewer are kept.

It prints one `script saved: …` or `script <tc>: not saved (why)` line per case. Approving the case
in the viewer marks its script **verified**; rejecting it sets it back to draft.

Commit `.qa/tests/` and `.qa/suites/` with the project: they are reviewable code.
