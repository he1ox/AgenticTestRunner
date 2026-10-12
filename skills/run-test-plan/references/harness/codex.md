# Harness: Codex

**Browser.** Installed as a Codex plugin, the shared `qa-browser` server comes from the
plugin's `mcp.json`. Installed with `npx skills add` (or if no `browser_*` tools show up),
register it once: `$Q doctor --harness codex` prints the `codex mcp add qa-browser -- node …`
command. Restart the session afterwards.

**Launch.** Batches run one at a time. If subagents are enabled (`spawn_agent`; multi-agent in
`/experimental` or `[features] multi_agent = true` in `~/.codex/config.toml`), spawn one
`worker` subagent per `LAUNCH` block with the prompt, and wait for its reply. Otherwise run the
batch inline: read `references/test-agent.md` and execute the prompt yourself.

**Close.** `$Q usage <runId> --batch <batch>`; add `--input <n> --output <n> --model <id>` if
Codex showed the subagent's usage (priced through `.qa/config.json → pricing`, else "n/a").
The browser server logs every call, so passing cases are saved as replayable scripts.

**Models.** Agents run on the session's model. To route tiers, set
`.qa/config.json → execution.tiers.<tier>.model` to Codex model names and pass that model when
spawning; `effort` maps to reasoning effort.
