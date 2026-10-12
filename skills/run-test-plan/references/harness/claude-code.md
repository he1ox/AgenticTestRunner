# Harness: Claude Code

**Browser.** The qa-runner plugin brings Test Agents `qa-runner:test-agent-1..3`, each bound to
its own browser (`qa-browser-1..3`). Installed with `npx skills add` or copied instead, there
are no such agents: register one server named `playwright` (`$Q doctor` prints the command) and
always call `$Q next <runId> --fallback` (also with `--release`).

**Launch.** For every `LAUNCH` block, in one message, call the Agent tool with exactly what it
says: `subagent_type`, `model`, `effort`, `run_in_background: true`, and the prompt.

**Close.** When an agent's completion notice arrives, before anything else:
`$Q usage <runId> --batch <batch> --transcript <output_file> --tokens <subagent_tokens> --tool-uses <n> --ms <duration_ms>`
with the values from the notice. The transcript gives the exact cost and saves passing cases as
replayable scripts; the harness may clear it later, so don't wait. Without `--transcript`, the
scripts come from the browser server's own call log and the cost from `--tokens`.

**Models.** Tiers default to `haiku` (simple) and `sonnet` (standard, complex); `simple`
failures are escalated to `sonnet`.
