# Harness: any other agent

Anything that can run shell commands and call MCP tools runs the skill this way.

**Browser.** Register one stdio MCP server named `qa-browser`: `node <skill>/scripts/browser-mcp.mjs shared`.
`$Q doctor` prints the exact entry with the absolute path. Its tools are Playwright MCP's
(`browser_navigate`, `browser_click`…).

**Launch.** Batches run one at a time. If your agent can start a subagent with its own context
and the browser tools, give it each `LAUNCH` block's prompt and wait for its reply. If not, run
the batch inline: read `references/test-agent.md`, then do what the prompt after `---` says.
Inline runs keep the browser output in your context, so finish one batch, close it, and only
then start the next.

**Close.** `$Q usage <runId> --batch <batch>` (`--input <n> --output <n> --model <id>` if you
know them; the cost is "n/a" otherwise). The browser server logs every call, so passing cases
are saved as replayable scripts, also when you ran the batch inline.

**Models.** Agents run on the session's model; tiers only set effort.
