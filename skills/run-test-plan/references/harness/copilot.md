# Harness: GitHub Copilot CLI

**Browser.** Installed as a plugin (`copilot plugin install he1ox/AgenticTestRunner`), the
shared `qa-browser` server comes from the plugin's `mcp.json`. Installed with
`npx skills add`, add it to `~/.copilot/mcp-config.json` or with `/mcp add`:
`$Q doctor --harness copilot` prints the entry.

**Launch.** Batches run one at a time. Hand each `LAUNCH` block's prompt to the built-in `task`
subagent and wait for its reply. If no subagent is offered, run the batch inline: read
`references/test-agent.md` and execute the prompt yourself.

**Close.** `$Q usage <runId> --batch <batch>` (no token count is reported, so the cost shows
"n/a"). The browser server logs every call, so passing cases are saved as replayable scripts.

**Models.** Agents run on the session's model; tiers only set effort.
