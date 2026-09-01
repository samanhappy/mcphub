# Git and contribution workflow

- Use Conventional Commits such as `feat:`, `fix:`, `chore:`, and `refactor:` in imperative present tense.
- Pull requests should describe the behavior change, list automated and manual validation, attach before/after evidence for UI work, and link related issues.
- Keep generated artifacts out of commits and pull requests.

## Issue tracker

GitHub Issues for `samanhappy/mcphub` are operated with `gh`. See [issue-tracker.md](issue-tracker.md) for commands and [triage-labels.md](triage-labels.md) for the canonical labels.

## Security advisories and code scanning

For private GitHub security work, first inspect the actual advisory or alert with:

```bash
gh auth status
gh api repos/samanhappy/mcphub/security-advisories/<ghsa_id>
gh api repos/samanhappy/mcphub/code-scanning/alerts/<alert_number>
gh api repos/samanhappy/mcphub/code-scanning/alerts/<alert_number>/instances
```

Compare advisory details against the current `main` and the tagged fix commit before deciding whether an issue is still live. Prefer these APIs over the GitHub code-scanning web page, which may hide details without the required session.
