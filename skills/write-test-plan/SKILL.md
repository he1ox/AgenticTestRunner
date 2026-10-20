---
name: write-test-plan
description: Use when asked to write, draft, update or review a QA test plan for a web app ("write the test cases for SHOP-42", "test the checkout flow", "arma el plan de pruebas", "add a case for the refund flow") before running it with browser agents. Turns whatever describes what to test (an issue-tracker ticket, a spec or user story, a pull request, or the human's own words) into .qa/plans/<KEY>.plan.json, scoped to one flow or the whole app, and gets the human's approval of the case list.
license: MIT
compatibility: Part of qa-runner; needs the run-test-plan skill installed alongside (its CLI validates the plan). Node.js 20+.
metadata:
  author: jorge.lopezg
  version: "0.9.0"
---

# Write Test Plan

A plan is data: test cases, steps, variants and guardrails in `.qa/plans/<KEY>.plan.json`,
following `../run-test-plan/schemas/test-plan.schema.json` (`schemaVersion: 2`). The
**run-test-plan** skill executes it; this one only writes it.

`$Q` means `node <the folder holding this SKILL.md>/../run-test-plan/scripts/qa-runs.mjs`, run
from the project root. If that file does not exist, ask the human to install the full set:
`npx skills add he1ox/AgenticTestRunner`.

## Steps

1. **Reuse first.** If `.qa/plans/<KEY>.plan.json` exists, update it rather than writing a new one.
   `<KEY>` is the ticket key when there is one (`SHOP-42`), else a short slug (`checkout-coupon`).
2. **Read the source.** Whatever the human pointed at: a ticket (description, latest comments,
   blocking bugs), a spec or user story, a pull request, or only their request. Match its scope:
   one flow, a feature, or a regression pass over the whole app. When the request leaves out the
   app's URL, the expected results or the scope, ask before drafting. Don't post to or
   transition a ticket.
3. **Study only what is unclear.** If behaviour forks by a variant (device, role, plan tier…) or
   the comparison with the reference app is unclear, have ONE read-only research pass study the
   code (a subagent on a small, cheap model if your agent has one, otherwise yourself) and write
   a discovery file of at most 120 lines next to the plan. List it in `references` with a section
   hint, so Test Agents read only their slice.
4. **Draft.**
   - One `group` per set of cases that share a login and variant, so one agent and one login
     serve the group. Different groups may run in parallel; tag a case `serial` if it must not
     run while another `serial` case runs (shared test data). Put "never do X" rules in
     `guardrails`.
   - Tag cases `readonly` or `writes` when the steps' wording does not make it obvious: `init`
     routes short read-only cases to a cheaper tier, and anything that changes data to the
     standard one. Set `agent.complexity` (or `model`/`effort`) only to overrule that routing.
   - `variants` keys and values must match `.qa/config.json`; `init` rejects unknown ones.
   - `environment.targets.app` is the system under test; add `targets.reference` only when
     results should be compared against another app, and pick `referenceCheck` per case.
   - Synthetic data only. No credentials in the plan: `environment.user` holds the login user;
     the password goes only in the agent prompt.
5. **Check.** `$Q init <plan> --check` validates the plan against the schema rules and
   `.qa/config.json` without creating a run. Fix what it lists.
6. **Approve.** Show the human the case list (id, title, group, variants, record yes/no) and get
   approval before anything runs. Ask for the password if you don't have it.

The example plan in the repository (`examples/.qa/plans/SHOP-42.plan.json`) shows every field.

## Related skills

- **run-test-plan**: executes the approved plan and opens the viewer.
- **qa-setup**: defines `variants`, `targets` and accounts in `.qa/config.json` first.
