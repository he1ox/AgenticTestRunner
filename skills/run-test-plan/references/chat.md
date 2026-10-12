# Chat with your agent

The viewer's **Chat with your agent** button (shortcut `t`) and each screenshot's chat icon open
a drawer scoped to the selected test case. The server runs one headless turn of an agent CLI per
message and keeps the session per case, so follow-ups continue the conversation.

The CLI is the project's harness (`.qa/config.json → harness`; Claude Code when none is set),
or `QA_CHAT_HARNESS` when the viewer starts:

| Harness | Command per turn | Follow-ups | Turn cost |
|---|---|---|---|
| `claude-code` | `claude -p --output-format stream-json` | `--resume <session>` | reported |
| `codex` | `codex exec --json --sandbox workspace-write` | `codex exec resume <thread>` | from `config.pricing` |
| `gemini` | `gemini -p … --output-format stream-json` | `--resume <session>` | from `config.pricing` |
| `opencode` | `opencode run --format json` | `--session <id>` | reported |
| `copilot` | `copilot -p … --output-format json` | conversation resent in the prompt | n/a |
| `cursor`, `generic` | none: the drawer is disabled and says why | | |

When the CLI is not on the viewer server's PATH, the drawer also says so instead of failing on
send; everything else in the viewer works. Switching CLIs starts a new conversation for a case.

The chat agent starts with a short instruction block (case id and file paths only) and opens the
brief, result, plan or mark syntax only when a question needs them. It can:

- read the run's files and images;
- run `qa-runs.mjs annotate`, its only write path, to mark or re-focus screenshots, and
  `qa-runs.mjs memory add` to propose a memory.

Each CLI enforces that its own way: Claude Code with `--tools`/`--allowedTools` and no MCP
servers; Gemini CLI with `--allowed-tools` for those two commands and no MCP servers; OpenCode
with `OPENCODE_PERMISSION` (edits, web and other shell commands denied); Copilot CLI with
`--deny-tool write` and `--allow-tool` for the two commands. Codex has no per-command allow list:
its `workspace-write` sandbox (needed to save marks) keeps it inside the project, and the
instructions forbid other edits.

| Variable | Default | Purpose |
|---|---|---|
| `QA_CHAT_HARNESS` | the project's harness | `claude`, `codex`, `gemini`, `opencode` or `copilot` |
| `QA_CHAT_BIN` | the harness's CLI | CLI to run (`QA_CLAUDE_BIN` still works for Claude Code) |
| `QA_CHAT_MODEL` | `sonnet` for Claude Code, else the CLI's default | Model |
| `QA_CHAT_EFFORT` | `low` | Effort (Claude Code, Codex) |

The drawer shows the cost of each turn when the CLI reports one or `config.pricing` prices its
model; "+" archives the conversation and starts a new one. Writes from the browser need the
viewer's `x-qa-viewer` header and its own origin, so another web page cannot trigger the agent.
