# qa-runner

This extension adds four skills for manual-style E2E testing with browser agents:
`qa-setup` (first run in a project), `write-test-plan`, `run-test-plan` and `replay-test-plan`.
Load the matching skill when the user asks to set up QA, write or run test cases, or replay a
saved Test plan.

In Gemini CLI the harness name is `gemini`: pass `--harness gemini` to `qa-runs.mjs init` and
follow `skills/run-test-plan/references/harness/gemini.md`. The extension registers the shared
browser server `qa-browser`.
