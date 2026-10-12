# Changelog

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
