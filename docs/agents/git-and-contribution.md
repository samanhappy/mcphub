# Git and contribution workflow

- Use Conventional Commits such as `feat:`, `fix:`, `chore:`, and `refactor:` in imperative present tense.
- Pull requests should describe the behavior change, list automated and manual validation, attach before/after evidence for UI work, and link related issues.
- Keep generated artifacts out of commits and pull requests.

## Issue tracker

GitHub Issues for `samanhappy/mcphub` are operated with `gh`. See [issue-tracker.md](issue-tracker.md) for commands and [triage-labels.md](triage-labels.md) for the canonical labels.

## Security advisories and code scanning

For private GitHub security work, use `gh api` as the primary interface for
reading and updating security advisories. Do not treat the GitHub security
advisories web page as the source of truth when the API can expose the details.
First inspect the actual advisory or alert with:

```bash
gh auth status
gh api --paginate 'repos/samanhappy/mcphub/security-advisories?state=draft&per_page=100'
gh api repos/samanhappy/mcphub/security-advisories/<ghsa_id>
gh api repos/samanhappy/mcphub/code-scanning/alerts/<alert_number>
gh api repos/samanhappy/mcphub/code-scanning/alerts/<alert_number>/instances
```

Compare advisory details against the current `main` and the tagged fix commit before deciding whether an issue is still live. Prefer these APIs over the GitHub code-scanning web page, which may hide details without the required session.

When a fix is released, update the advisory through the API with its patched
version and the appropriate state, preserving the existing advisory fields:

```bash
gh api --method PATCH \
  repos/samanhappy/mcphub/security-advisories/<ghsa_id> \
  --input advisory-update.json
```

The JSON payload should include `vulnerabilities[].patched_versions` and, when
the advisory is ready for disclosure, `state: "published"`.
