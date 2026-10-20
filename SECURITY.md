# Security policy

qa-runner drives a real browser with the accounts you give it, stores screenshots, recordings
and logs of the apps you test, and runs a local viewer server. We take reports about any of
that seriously.

## Supported versions

Security fixes go into the latest release. Please update to it before reporting.

| Version | Supported |
| --- | --- |
| Latest minor (see [releases](https://github.com/he1ox/AgenticTestRunner/releases)) | Yes |
| Older | No |

## Report a vulnerability

**Do not open a public issue, discussion or pull request.** Report it privately through
GitHub: [**Report a vulnerability**](https://github.com/he1ox/AgenticTestRunner/security/advisories/new)
(the *Security* tab → *Advisories* → *Report a vulnerability*). Only the maintainers can see it.

Please include:

- what an attacker can do, and what they need first (a crafted plan, a link to the viewer,
  a pull request whose scripts get exported...);
- steps or a minimal plan, command or request that shows it;
- the version, harness, OS and Node version.

## What happens next

- We acknowledge your report within **3 working days**.
- We confirm the issue and tell you our plan within **10 working days**.
- We fix it, publish a release and a GitHub security advisory, and credit you unless you prefer
  otherwise. We aim to do this within **90 days** of your report and will keep you updated.

## In scope

- Path traversal or file access outside the project's `.qa/` from a run id, test id or viewer URL.
- The viewer server accepting requests it should not (other origins, other hosts).
- Code execution from data that should be inert: plans, recorded scripts, exported Playwright
  files, annotations.
- Secrets (passwords from `{{secret}}`, tokens) written to evidence, logs, briefs or reports.
- Weaknesses in the GitHub Actions workflows of this repository.

## Out of scope

- Behavior of the app under test, or of the agent harness or model you run qa-runner with.
- Findings that need an already-compromised machine or a malicious local user.
- Reports from automated scanners without a demonstrated impact.
