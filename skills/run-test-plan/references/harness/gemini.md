# Harness: Gemini CLI

**Browser.** Installed as an extension (`gemini extensions install https://github.com/he1ox/AgenticTestRunner`),
the shared `qa-browser` server comes from `gemini-extension.json`. Installed with
`npx skills add`, register it once: `$Q doctor --harness gemini` prints the
`gemini mcp add qa-browser node …` command.

**Launch.** Batches run one at a time. Delegate each `LAUNCH` block to the built-in
`generalist` subagent with the prompt (`@generalist`), and wait for its reply. If subagents are
disabled in your version, run the batch inline: read `references/test-agent.md` and execute the
prompt yourself.

**Close.** `$Q usage <runId> --batch <batch>`; add `--input <n> --output <n> --model <id>` if
`/stats` showed the subagent's usage (priced through `.qa/config.json → pricing`, else "n/a").
The browser server logs every call, so passing cases are saved as replayable scripts.

**Models.** Agents run on the session's model; tiers only set effort.
