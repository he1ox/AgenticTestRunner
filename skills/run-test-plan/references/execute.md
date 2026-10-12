# Step 3 — Execute

`init` already decided who runs what: it cut the plan into **batches** (one group's cases, at most
`execution.maxCasesPerAgent` per agent), gave each a **tier** and a model/effort, and wrote it all
to `schedule.json`. Your job is only to launch what `$Q next` prints and to report back. **How**
to launch depends on your harness: `references/harness/<name>.md` (the name is in `init`'s
`harness:` line).

## The loop

1. `$Q next <runId>` prints one `LAUNCH` block per batch that can start now, then `WAIT` or `DONE`.
2. For **every** `LAUNCH` block, start a Test Agent the way your harness file says, with the text
   between `<<<PROMPT` and `PROMPT>>>` as its prompt, after replacing `{{PASSWORD …}}` with the
   password (the human's, or the value of the `env:NAME` it names). Never put the password
   anywhere else. With no subagent tool, run the batch inline (`references/test-agent.md`).
3. When a batch finishes, **before anything else** close it; this also records its cost when
   your harness reports one: `$Q usage <runId> --batch <batch>` plus whatever your harness file
   lists (`--transcript`, `--tokens`, `--input`/`--output`, `--model`, `--ms`, `--tool-uses`).
   Never Read a transcript into this session. The same call saves every passing case as a
   replayable script in the test library (`references/library.md`), from the transcript or else
   the browser server's call log; just relay its lines.
4. Run `$Q next <runId>` again and launch what it prints. Repeat until `DONE`.

`next` also **escalates** when tiers run on different models: a case a `simple`-tier batch
finished as fail, blocked (not `needs-input`), unfinished, or with contract warnings is re-run
once on the standard tier; the first attempt moves to `tc/<id>/attempts/`. You just launch the
`~esc` batch like any other.

## Rules

- Don't read results, evidence or briefs here; `$Q status <runId>` gives one line per case.
- Don't change the model, effort or batch an agent gets: routing lives in the plan
  (`testCases[].agent`, `defaults.agent`) and `.qa/config.json → execution.tiers`.
- An agent may stop and wait on a question (`ask`); the human answers in the viewer. If a case
  comes back `blocked` with `needs-input`, run `$Q questions <runId>`, ask the human, record the
  answer with `$Q answer …`, and retest.
- An agent that replies `BLOCKED no browser tools` had no browser server: run `$Q doctor` and
  register it (the **qa-setup** skill), then `$Q next <runId> --release <batch>`.
- If an agent dies mid-batch: `$Q next <runId> --release <batch>` puts its unfinished cases
  back, then launch what it prints.
- If `init` printed `secret needed: env:NAME`, put that variable's value in the prompt next to
  the password, labeled with the same `env:NAME`.
- Project procedures in `.qa/config.json → capabilities` reach every brief as a file path; the
  agent reads one only when a step needs it.

## Models and effort (what `init` picks)

| Tier | When | Claude Code default |
|---|---|---|
| simple | ≤ 6 read-only steps, no reference check, no recording, no recent failure | `haiku` / `medium` |
| standard | changes data, 7–10 steps, records video, non-default tool; escalations | `sonnet` / `medium` |
| complex | reference check `always`, > 10 steps, failed or rejected recently | `sonnet` / `high` |

Other harnesses get the effort but no model: their agents run on the session's model unless
`.qa/config.json → execution.tiers.<tier>.model` names one your harness understands. A batch
takes its hardest case's tier. Override per case or plan with
`"agent": { "complexity": "simple" | "standard" | "complex", "model": "…", "effort": "…" }`.

## Parallel runs

Only the Claude Code plugin has a browser pool: up to `execution.maxParallel` batches (default
3) run at once, each in its own isolated browser. Every other setup runs one batch at a time on
the shared browser. When the app allows one session per user (`execution.sessions: "exclusive"`,
the default), each running batch needs its own account from `execution.accounts`; with only the
plan's login, batches run one at a time. Chunks of one group always run in order, and cases
tagged `serial` never run alongside another `serial` case.
