---
name: polish-release
description: Polish an existing GitHub release's body into the project's bilingual (English + Chinese) template format with a References section built from merged PRs. Use when 修改 release、整理发布说明、release notes、编辑 release 内容、发版后整理、polish release、edit release body.
---

# Polish Release

Rewrite an existing GitHub release's body into the project's bilingual template, then push it back. The repo's release pipeline auto-generates a raw body on tag push (`generate_release_notes: true`) that does not match the bilingual template — this skill cleans it up.

## Structure contract

The required structure lives in exactly one place: `.github/release-notes-template.md` (read it). It is enforced by `scripts/validate-release-notes.js` (CI runs it on publish/edit). The rules:

- Section order must match the template.
- `Summary`, `摘要`, `References` must be present and non-empty.
- Each optional English section (`Features`/`Fixes`) and its Chinese pair must appear together — never one without the other.
- Optional sections with no content are omitted entirely — never an empty section, never `None`/`无` placeholders.
- `References` bullets use the exact format `<title> by @<login> in <pull url>`, followed by one `Full changelog:` line.
- `New Contributors` bullets use `@<login> made their first contribution in #<number>`.

## Workflow

1. **Resolve the target release.** Use the tag the user gave (e.g. `v1.0.14`), else the latest: `gh release list --limit 1`.

2. **Generate the deterministic parts.**
   ```
   node scripts/build-release-notes.js <tag>
   ```
   This resolves the previous tag (compare line in the existing body, else `git describe`), fetches merged PRs in the range, and prints a draft skeleton to stdout with `<<FILL: ...>>` markers where you must write content. It reuses the existing body's `## New Contributors` when present and falls back to detecting new contributors itself. It never writes files.

3. **Write the draft in the conversation** (not in the working tree). From the PR list in the skeleton:
   - `## Summary` — one English paragraph on why this release matters.
   - `## 摘要` — Chinese translation of the Summary.
   - `## Features`/`## 功能` — user-facing additions (omit if none).
   - `## Fixes`/`## 修复` — bug fixes, reliability, dependency bumps (omit if none).
   - Translate each bullet into Chinese: PR title in Chinese, then `by @<author>` and URL as-is.
   - Keep `## New Contributors` and `## References` as printed, replacing every `<<FILL: ...>>` marker. Drop any section whose content is empty.

4. **Validate locally before pushing.** Write the finished draft to a throwaway temp file (e.g. `/tmp/release-notes-<tag>.md`, never inside the repo), then:
   ```
   node scripts/validate-release-notes.js /tmp/release-notes-<tag>.md
   ```
   On failure: report which section is missing/empty/asymmetric/out-of-order/malformed, fix the draft, re-validate.

5. **Push directly (no confirmation round).**
   ```
   gh release edit <tag> --notes-file /tmp/release-notes-<tag>.md
   ```

6. **Clean up.** Delete the temp file.

## Notes

- Editing a release is externally visible and re-triggers the `release: edited` GitHub event (which runs the validator in CI). Always validate locally first.
- The temp file is only for validation input — keep iteration in the conversation.
- If the existing body already partially follows the template (e.g. a prior run already edited it), reuse the good parts rather than regenerating from scratch.
