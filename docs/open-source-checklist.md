# Open source checklist

What qa-runner has in place so people can use it, trust it and contribute to it, and what is
left. Review it when the project changes shape: a second maintainer, a 1.0 release, a new
distribution channel. `[x]` is done; `[ ]` is open, with who or what it waits for.

## 1. Legal and licensing

- [x] OSI-approved license in `LICENSE` (MIT), named in every manifest (`plugin.json` → `license`).
- [x] Contributions licensed under the project license (inbound = outbound), stated in
  `CONTRIBUTING.md`.
- [x] Third-party text used with attribution: the Code of Conduct (Contributor Covenant 2.1, CC BY 4.0).
- [ ] Decide whether contributors sign off commits (DCO). Not needed for MIT with inbound =
  outbound; revisit if a company asks for it.

## 2. Community files

- [x] `README.md`: what it is, who it is for, install, use, contribute, license, badges.
- [x] `CONTRIBUTING.md`: set up, checks, repository rules, commit convention, review, releases.
- [x] `CODE_OF_CONDUCT.md` with a private way to report.
- [x] `SECURITY.md`: supported versions, private reporting, response times, scope.
- [x] `SUPPORT.md`: where questions, bugs and vulnerabilities go.
- [x] `CHANGELOG.md` with an **Unreleased** section; `ROADMAP.md`.
- [x] `AGENTS.md` for coding agents, linked from `CONTRIBUTING.md`.
- [x] Issue forms (bug, feature) with a reminder to redact secrets; blank issues off, questions
  routed to Discussions and vulnerabilities to private reports.
- [x] Pull request template with the repository's own checklist.
- [x] `CODEOWNERS` so every pull request gets a reviewer.
- [ ] Seed 3–5 issues labeled `good first issue` (small, well-described, with pointers to the
  files) so newcomers have somewhere to start.
- [ ] Pin a welcome discussion in Discussions (what the project is, how to ask, what help is
  wanted). GitHub's default categories (Q&A, Ideas, Show and tell...) are in place.

## 3. Code quality and CI

- [x] One command runs every check: `node scripts/check.mjs`.
- [x] Tests with `node:test` (no dependencies) in `test/`, isolated from the checkout's `.qa/`.
- [x] CI on every pull request and push to `main`: Linux, Windows and macOS × Node 20, 22, 24.
- [x] Generated files checked (`build.mjs --check`), skills validated against the Agent Skills spec.
- [x] The real install path checked: `npx skills add ./ --list` finds every skill.
- [x] Workflows linted with actionlint.
- [x] One aggregate required check (`ci ok`) so the matrix can change without touching settings.
- [x] PR titles follow Conventional Commits (squash-merge makes them the history).
- [x] Concurrency: superseded pull request runs are cancelled; every job has a timeout.
- [x] Line endings normalized (`.gitattributes`) and editor defaults shared (`.editorconfig`).
- [ ] Code coverage: `node --test --experimental-test-coverage` works on Node 22+; publish it
  once the suite covers the viewer server and replay.
- [ ] Tests for the viewer server (`server.mjs`) and replay against a real browser, in a
  separate job that installs Playwright's browser.

## 4. Security and supply chain

- [x] Private vulnerability reporting enabled (Security → Advisories).
- [x] Secret scanning and push protection on.
- [x] Dependabot alerts and security updates on; weekly version updates for GitHub Actions.
- [x] Every action pinned to a full commit SHA, with the tag in a comment.
- [x] Least-privilege tokens: `contents: read` by default in every workflow, write scopes per job;
  repository default token is read-only; `persist-credentials: false` on checkout.
- [x] CodeQL (`security-extended`) for JavaScript and for the workflows, weekly and on every PR.
- [x] Dependency review on pull requests.
- [x] OpenSSF Scorecard, with its badge in the README.
- [x] Workflows from first-time contributors' forks wait for a maintainer's approval.
- [x] No `pull_request_target`; untrusted input (PR titles) reaches scripts through `env`, never
  `${{ }}` inside `run`.
- [ ] Sign releases and publish provenance (GitHub artifact attestations) once releases ship
  files beyond the source archive.
- [ ] Apply for the [OpenSSF Best Practices badge](https://www.bestpractices.dev) once the open
  items here are closed.

## 5. Repository settings (GitHub)

- [x] Description, website and topics set, so the repository shows up in search.
- [x] Issues and Discussions enabled.
- [x] Squash merge only, with the PR title and body as the commit; branches deleted on merge;
  auto-merge and "update branch" allowed.
- [x] Rulesets on `main`:
  - **main: pull requests and green CI** (no bypass): pull request required, `ci ok` and
    `conventional title` must pass, conversations resolved, no force-push, no deletion.
  - **main: maintainer review** (admins may bypass in a pull request): one approving review
    from a code owner, stale approvals dismissed on push.
- [x] Labels for triage: `triage`, `dependencies`, `breaking change`, `harness`, plus GitHub's
  defaults (`good first issue`, `help wanted`, ...).
- [ ] Turn on **Settings → Moderation → Reported content** so "Report to repository admins"
  (named in the Code of Conduct) reaches you. Not available through the API.
- [ ] Add a social preview image (Settings → General → Social preview), 1280×640.
- [ ] When a second maintainer joins: add them to `CODEOWNERS`, and remove the admin bypass
  from the review ruleset so every change gets a second pair of eyes.

## 6. Releases

- [x] Semantic Versioning, one version everywhere via `scripts/bump-version.mjs`.
- [x] Release workflow: a `vX.Y.Z` tag checks the version, runs every check and publishes the
  GitHub release from the changelog.
- [ ] Tag `v0.9.0` on the commit that released it, so the first GitHub release exists.

## 7. Governance and maintenance

- [x] Expected response times written down (first review within a week, security within 3
  working days).
- [ ] `GOVERNANCE.md` once there is more than one maintainer: who decides, how someone becomes
  a maintainer.
- [ ] A stale policy, only if the issue queue grows beyond what can be triaged by hand.
