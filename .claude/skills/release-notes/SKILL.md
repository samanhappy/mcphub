---
name: release-notes
description: Edit an existing GitHub release's body into the project's bilingual (English + Chinese) template format with a References section built from merged PRs. Use when 修改 release、整理发布说明、release notes、编辑 release 内容、发版后整理、edit release body.
---

# Release Notes

Rewrite an existing GitHub release's body into the project's bilingual template, then push it back. The repo's release pipeline auto-generates a raw body on tag push (`generate_release_notes: true`) that does not match the bilingual template — this skill cleans it up.

## Required structure

Every release body must follow this section order. Optional sections are omitted entirely when they have no content — never leave an empty section, never use `None`/`无` placeholders.

| Section | Required | Chinese pair |
|---|---|---|
| `## Summary` | yes (non-empty) | — |
| `## Features` | optional | `## 功能` |
| `## Fixes` | optional | `## 修复` |
| `## Breaking Changes` | optional | `## 破坏性变更` |
| `## 摘要` | yes (non-empty) | pair of Summary |
| `## New Contributors` | optional (English only, no Chinese pair) | — |
| `## References` | yes (non-empty) | — |

Rules enforced by `scripts/validate-release-notes.js` (CI runs it on publish/edit):
- `Summary`, `摘要`, `References` must be present and non-empty.
- Each optional English section and its Chinese pair must appear together — having one without the other fails validation.
- Optional sections with no real content are omitted, not stubbed.

## Workflow

1. **Resolve the target release.**
   - If the user gave a tag (e.g. `v1.0.14`), use it.
   - Otherwise use the latest: `gh release list --limit 1`.

2. **Fetch the existing body.**
   - `gh release view <tag> --json body -q .body`
   - Read it to find an existing `Full changelog: ...compare/<prev>...<tag>` line to learn the previous tag. Also note any PR list already present, but do not trust it blindly — re-fetch authoritatively in step 4.

3. **Resolve the previous tag (the compare range).**
   - Preferred: parse `compare/vX...vY` from the existing body.
   - Fallback: `git describe --tags --abbrev=0 <tag>^` to get the tag before `<tag>`.
   - First-ever tag (no previous tag exists): fetch all merged PRs up to the tag date; if more than 50, take the 50 most recent and flag it for the user to review.

4. **Fetch merged PRs in the range.**
   - Use `gh pr list --state merged --limit 300 --json number,title,author,url,mergedAt` and filter to those merged after the previous tag (or up to `<tag>`'s publish date for the first-tag case). If the range exceeds 300 PRs, fetch in pages and warn the user.
   - Drop bot/maintenance PRs only if the user asks; otherwise include all.
   - Identify new contributors: for each distinct human author of a merged PR in the range, check whether they had any merged PR before the previous tag (`gh pr list --state merged --author <user> --limit 1`, filter by merged date). Authors with none before the previous tag are new contributors. Exclude bot accounts (`dependabot[bot]`, `github-actions[bot]`, `Copilot`, and any `*[bot]` login).

5. **Draft the body.** Generate each section from the PR set:
   - `## Summary` — one English paragraph on why this release matters.
   - `## Features` — user-facing additions/improvements (omit if none).
   - `## Fixes` — bug fixes, reliability, dependency bumps (omit if none).
   - `## Breaking Changes` — only when present (omit if none).
   - `## 摘要` — Chinese translation of the Summary.
   - `## 功能` / `## 修复` / `## 破坏性变更` — Chinese pairs, present iff the English counterpart is present. Mirror the same bullets.
   - `## New Contributors` — one bullet per new contributor (English only, no Chinese pair). Omit the whole section if there are none. Format:
     ```
     - @<login> made their first contribution in #<number>
     ```
   - `## References` — one bullet per merged PR in the exact format, followed by the Full changelog line:
     ```
     - <PR title> by @<author login> in https://github.com/samanhappy/mcphub/pull/<number>
     - Full changelog: https://github.com/samanhappy/mcphub/compare/<prev>...<tag>
     ```

6. **Present the draft in the conversation.** Show the full markdown and ask the user to confirm or request edits. Iterate until the user says to push. Do not write the draft to a file in the working tree.

7. **Validate locally before pushing.** Write the draft to a throwaway temp file (e.g. `/tmp/release-notes-<tag>.md`, never inside the repo), then:
   ```
   node scripts/validate-release-notes.js /tmp/release-notes-<tag>.md
   ```
   - On failure: report which section is missing/empty/asymmetric, fix the draft, re-validate.
   - On success: proceed.

8. **Push the edited body.**
   ```
   gh release edit <tag> --notes-file /tmp/release-notes-<tag>.md
   ```

9. **Clean up.** Delete the temp file.

## Notes

- Editing a release is externally visible and re-triggers the `release: edited` GitHub event (which runs the validator in CI). Always validate locally first.
- The temp file is only for validation input — it is not a draft the user edits. Keep iteration in the conversation.
- If the existing body already partially follows the template (e.g. a prior run already edited it), reuse the good parts rather than regenerating from scratch.
