# Git and contribution workflow

- Use Conventional Commits such as `feat:`, `fix:`, `chore:`, and `refactor:` in imperative present tense.
- Pull requests should describe the behavior change, list automated and manual validation, attach before/after evidence for UI work, and link related issues.
- Keep generated artifacts out of commits and pull requests.
- `gh` is not guaranteed to be on the agent shell `PATH`: agent shells run non-interactively with a minimal `PATH` and do not load the user's profile, so a bare `gh ...` can fail with `command not found` even when `gh` is installed. See [development.md](development.md) ("Agent shell `PATH`") for how to locate and export it.

## Issue tracker

GitHub Issues for `samanhappy/mcphub` are operated with `gh`. See [issue-tracker.md](issue-tracker.md) for commands and [triage-labels.md](triage-labels.md) for the canonical labels.

## Pull request review

Prefer the `gh` CLI over scraping the GitHub web UI or hand-calling the REST API. For a review, read the structured metadata, per-file patches, and the linked issue with:

```bash
gh pr view <number> --json title,body,files,commits,mergeable,headRefName,baseRefName
gh pr diff <number>
gh issue view <number>
```

`gh pr diff` prints the same unified diff as the web view. When the PR branch exists locally, cross-check it against the remote before judging the change:

```bash
git fetch origin pull/<number>/head:<local-branch>
git diff main...<local-branch> --stat
```

## Security advisories and code scanning

Reading, accepting, updating, and publishing repository security advisories is a
dedicated workflow with its own state machine, CVE flow, and disclosure ordering:
see [security-advisories.md](security-advisories.md).

For code-scanning alerts, use `gh api` as the primary interface instead of the
web page, which may hide details without the required session:

```bash
gh auth status
gh api repos/samanhappy/mcphub/code-scanning/alerts/<alert_number>
gh api repos/samanhappy/mcphub/code-scanning/alerts/<alert_number>/instances
```

Compare alerts against the current `main` and the tagged fix commit before
deciding whether an issue is still live.
