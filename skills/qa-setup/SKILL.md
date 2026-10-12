---
name: qa-setup
description: Use once per project before the first QA run with browser agents, or when a run fails because the browser tools are missing ("set up qa-runner", "configura las pruebas e2e", "the test agent has no browser"). Checks Node, npx and ffmpeg, registers the Playwright browser server for this agent harness, and writes .qa/config.json by asking the human a few questions.
license: MIT
compatibility: Part of qa-runner; needs the run-test-plan skill installed alongside. Node.js 20+, npx; ffmpeg only for recordings.
metadata:
  author: jorge.lopezg
  version: "0.8.0"
---

# QA Setup

Gets a project ready for **run-test-plan**: a machine that can start the browser, a harness that
can see it, and a `.qa/config.json` that holds the project's facts so plans and runs don't repeat
them. Every later skill reads that file; nothing in it is a secret.

`$Q` means `node <the folder holding this SKILL.md>/../run-test-plan/scripts/qa-runs.mjs`, run
from the project root. If that file does not exist, ask the human to install the full set:
`npx skills add he1ox/AgenticTestRunner`.

## Steps

1. **Check.** `$Q doctor --harness <your harness>` (`claude-code`, `codex`, `cursor`, `gemini`,
   `opencode`, `copilot`, or `generic` for anything else). Fix every `FIX` line with the human;
   `--` lines are optional.
2. **Browser.** If you were installed as a plugin or extension (Claude Code, Codex, Cursor,
   Copilot, Gemini), the browser server is already registered. Otherwise show the human the
   registration command or entry `doctor` printed and let them apply it: it changes their agent's
   settings, so never edit those files yourself. A restart of the agent session is usually needed.
   `$Q doctor --browser` then starts the browser once to prove it works.
3. **Interview.** Ask only what you can't read from the repo, one short batch of questions:
   - What is the app under test called, and is there a reference app to compare against
     (legacy, production, a design)? → `targets.app`, `targets.reference`
   - Which issue tracker holds test tickets, and what is an issue's URL? → `tracker.name`,
     `tracker.issueUrl` with `{key}`
   - Do cases fork by device, role, plan tier…? → `variants` (key → label + values)
   - Can one user be logged in twice at once? → `execution.sessions` (`shared` | `exclusive`);
     test accounts as `{ "user": "…", "secret": "env:NAME" }` in `execution.accounts`. Ask for
     the variable's name, never the password.
   - Does the test environment show real customer data? → `evidence.blurPersonalData`
4. **Write.** `.qa/config.json` with `"$schema"` pointing at
   `../run-test-plan/schemas/config.schema.json` (relative to `.qa/`; use the real path), the
   answers, and `"harness": "<name>"` so later runs don't depend on detection. Show it to the
   human before saving. Add `.qa/runs/` to `.gitignore`; `.qa/plans/`, `.qa/tests/`,
   `.qa/suites/` and `.qa/memory/` are meant to be committed.
5. **Confirm.** `$Q doctor` again: no `FIX` lines left. Point the human at **write-test-plan**
   for their first plan.

## Related skills

- **write-test-plan**: the next step, a plan for a ticket.
- **run-test-plan**: runs plans; reads `harness`, `execution` and `variants` from this config.
