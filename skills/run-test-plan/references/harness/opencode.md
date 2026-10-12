# Harness: OpenCode

**Browser.** Add the shared `qa-browser` server to `opencode.json → mcp` (project) or
`~/.config/opencode/opencode.json`: `$Q doctor --harness opencode` prints the `type: "local"`
entry. Restart OpenCode afterwards.

**Launch.** Batches run one at a time. Call the Task tool with the `general` subagent and the
prompt for each `LAUNCH` block, and wait for its reply. If the Task tool is denied, run the
batch inline: read `references/test-agent.md` and execute the prompt yourself.

**Close.** `$Q usage <runId> --batch <batch>`; add `--input <n> --output <n> --model <id>` if
the child session showed its usage (priced through `.qa/config.json → pricing`, else "n/a").
The browser server logs every call, so passing cases are saved as replayable scripts.

**Models.** Agents run on the `general` subagent's model; to route tiers, set
`.qa/config.json → execution.tiers.<tier>.model` to `provider/model` ids and pass them along.
