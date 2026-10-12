# Harness: Cursor

**Browser.** Installed as a Cursor plugin (Agent Plugins format), the shared `qa-browser`
server comes from the plugin's `mcp.json`. Installed with `npx skills add`, add it to
`.cursor/mcp.json`: `$Q doctor --harness cursor` prints the entry. Enable it in Cursor's MCP
settings if it shows as off.

**Launch.** Batches run one at a time. If the Task tool is available, start one subagent per
`LAUNCH` block with the prompt and wait for its reply (Cursor may only accept the `fast` model
for subagents; leave the model unset). Otherwise run the batch inline: read
`references/test-agent.md` and execute the prompt yourself.

**Close.** `$Q usage <runId> --batch <batch>` (Cursor does not report subagent tokens, so the
cost shows "n/a"). The browser server logs every call, so passing cases are saved as replayable
scripts.

**Models.** Agents run on the session's model; tiers only set effort.
