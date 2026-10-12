---
name: run-test-plan
description: Use when asked to execute QA test cases or a test plan (an issue-tracker test ticket, "run the test cases", "corre los test cases", "ejecuta el plan", retest a ticket) against a web app with browser agents, with a local viewer showing each case's result, evidence, and optional recording. Also use to reopen the viewer or retest the cases a reviewer rejected.
license: MIT
compatibility: Any agent that runs shell commands (Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Copilot CLI…). Needs Node.js 20+, npx for the Playwright MCP browser server, and ffmpeg only for recordings.
metadata:
  author: jorge.lopezg
  version: "0.9.0"
---

# Run Test Plan

Browser Test Agents execute manual-style E2E cases; a local viewer shows results; a human
reviews. You (the orchestrator) plan and consolidate. Everyone talks through files with a fixed
contract, so no agent needs the conversation and this session never holds evidence.

```
plan.json ──init──▶ tc/<id>/brief.md ──Test Agent──▶ tc/<id>/result.json + evidence/
   ▲                                                         │
   └──── retest ◀── review.json ◀── viewer (human) ◀── validate (contract warnings)
```

`$Q` below means `node <the folder holding this SKILL.md>/scripts/qa-runs.mjs`, run from the
project root. Runs go to `.qa/runs/<runId>/`, plans to `.qa/plans/`, project settings to
`.qa/config.json` (`schemas/config.schema.json`). No dependencies; recording needs `ffmpeg`.

**Your harness** decides how Test Agents start. It is `.qa/config.json → harness`, else
`QA_HARNESS`, else detected (Claude Code), else `generic`; pass `--harness <name>` to `init` when
you know better: `claude-code`, `codex`, `cursor`, `gemini`, `opencode`, `copilot`, `generic`.
Read `references/harness/<name>.md` once, before step 3. First run in a project, or no browser
tools? Use the **qa-setup** skill (or `$Q doctor`).

## Workflow

Read each step's reference **when you reach that step**, not before.

1. **Plan** → the **write-test-plan** skill. Reuse or draft `.qa/plans/<KEY>.plan.json`, then
   get the human's approval of the case list before running.
2. **Init + viewer** → `$Q init <plan> [--label txt] [--record] [--only TC-1,TC-2] [--harness h]`,
   then `$Q open <runId>`. Open the viewer before launching agents: recording streams to it, and
   agents ask the human through it. `init` adds relevant memories to each brief, schedules the
   batches with their model and effort, and lists any `secret needed: env:NAME` you must pass
   in the agent prompt.
3. **Execute** → `references/execute.md` + `references/harness/<name>.md`. Launch exactly what
   `$Q next <runId>` prints, close each batch with `$Q usage --batch` the moment it finishes, and
   call `next` again until `DONE`. Never read agent transcripts, evidence or results here; use
   `$Q status <runId>`.
4. **Validate** → `$Q validate <runId>`. Fix credential leaks yourself; send other warnings back
   to the agent or flag them to the reviewer. Never edit a result to look better.
5. **Review + report** → `references/review.md`. The human approves, rejects or asks for a
   retest in the viewer; `$Q init <plan> --retest <runId>` reruns exactly those cases.

This orchestration is bookkeeping: the scripts decide routing, so a mid-size model at medium
effort runs it as well as a larger one. Spend effort on drafting the plan, not here.

Only when needed: `references/memory.md` (what agents remember, live questions, secrets),
`references/recording.md` (video), `references/annotate.md` (screenshot marks),
`references/chat.md` (the viewer's agent chat), `references/library.md` (how passing cases
become replayable scripts), `references/test-agent.md` (the rules, when you run a batch inline).

## Guardrails

- Viewer and server are local only (`127.0.0.1`). Keep `.qa/runs/` out of version control.
- Never write credentials into plans, briefs, results, evidence, or memory. `validate` scans
  for leaks; memory holds secrets only as `env:NAME` references.
- Nothing an agent learns is reused until a human approves it.
- Synthetic test data only. Screenshots are blurred only when `.qa/config.json → evidence.blurPersonalData`
  is true (environments that show real customer data); test environments leave it off.
- Don't post to the issue tracker or transition a ticket without explicit confirmation.
- Keep the viewer generic: run facts belong in plans and results, project facts in
  `.qa/config.json`. If a contract changes, bump `schemaVersion` and keep reading older runs.

## Related skills

- **qa-setup**: first run in a project; writes `.qa/config.json`, registers the browser.
- **write-test-plan**: drafts and updates the plan this skill runs.
- **replay-test-plan**: runs saved Test plans without an agent and repairs stale scripts.
