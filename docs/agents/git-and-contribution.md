# Git and contribution workflow

- Use Conventional Commits such as `feat:`, `fix:`, `chore:`, and `refactor:` in imperative present tense.
- Pull requests should describe the behavior change, list automated and manual validation, and link related issues.
- Keep generated artifacts out of commits and pull requests.
- `gh` is not guaranteed to be on the agent shell `PATH`: agent shells run non-interactively with a minimal `PATH` and do not load the user's profile, so a bare `gh ...` can fail with `command not found` even when `gh` is installed. See [development.md](development.md) ("Agent shell `PATH`") for how to locate and export it.

## UI screenshots in pull requests

- Unless explicitly requested otherwise, use the English UI for all screenshots.

- Any pull request with visible UI changes must include browser screenshots uploaded to GitHub in the PR body or a PR comment.
- Show before/after screenshots for changes to existing UI, or the resulting state for new UI. Capture the affected states and viewport sizes, including mobile when responsive behavior changes.
- Label viewport sizes and disclose mocked data or simulated states. Verify that the uploaded images render in the PR before considering the task complete.

Use GitHub CLI v2.99.0 or later to upload local screenshots with `--attach`. Repeat the flag for multiple files. If the PR body contains a Markdown image reference to an attached file, `gh` replaces the local reference with the uploaded URL and keeps the image in place. [GitHub CLI attachment documentation](https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli)

```bash
gh pr create --title "Describe the change" --body-file pr-body.md --attach ./desktop.png --attach ./mobile.png
gh pr edit 123 --attach ./desktop.png --attach ./mobile.png
gh pr comment 123 --attach ./desktop.png --attach ./mobile.png
```

## Public documentation formatting

- In Markdown and MDX prose, keep each paragraph on one source line and separate paragraphs with a blank line. Do not manually wrap prose to a fixed column width; let the editor or viewer wrap it visually. Preserve intentional line breaks in lists, tables, code blocks, and MDX components.
- Match the surrounding formatting and apply the same paragraph convention to both English and Chinese documentation. Avoid reformatting unrelated content.

## Issue and PR tracker

GitHub Issues and Pull Requests for `samanhappy/mcphub` are operated with `gh`. See [issue-tracker.md](issue-tracker.md) for commands and [triage-labels.md](triage-labels.md) for the canonical labels. See [GitHub coordination](github-coordination.md) for exclusive task ownership and review follow-up.

## Pull request review

Use the [github-worker skill](../../.agents/skills/github-worker/SKILL.md) for coordinator-assigned review tasks, including standalone external PRs. Record reviewed head/base SHAs, re-review changed heads, and run untrusted contributor code only in an isolated environment without secrets or write-capable credentials. The maintainer retains final merge authority.

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
