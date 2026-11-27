# GitHub comment sync

Mirrors GitHub issue comments into their Multica issue counterparts for the
`GitHub issue sync · mcphub` autopilot. GitHub is **read-only** here; the only
writes are Multica comments.

A comment's identity is its marker `<!-- gh-comment:<github id> -->`:

| Situation | Action |
|---|---|
| GitHub has the comment, Multica has no marker | add |
| both exist, rebuilt body differs | update |
| Multica has a marker, GitHub no longer has it | tombstone (never delete) |

Rebuilt bodies are a deterministic function of the GitHub `created_at`, author,
URL and body, so a second run over unchanged data plans zero writes.

## Usage

```bash
MULTICA_CLI_PATH="$MULTICA_CLI_PATH" \
python3 .multica/sync/gh_comment_sync.py \
  [--repo samanhappy/mcphub] \
  [--project-id 1ce070d8-2888-443c-b1ac-db310ed7cd29] \
  [--window-hours 48] \
  [--issues 1582,1567] \
  [--dry-run] \
  [--json] \
  [--max-writes 50] \
  [--no-delete-reconcile]
```

- `--issues` skips the open-issue + update-window scan and only processes the
  listed GitHub issue numbers.
- `--dry-run` runs the same diff as a real run and writes nothing.
- `--json` prints one JSON object on stdout; all logs go to stderr.
- `--max-writes` caps writes per run; the remainder is deferred to the next run.
- `--no-delete-reconcile` skips tombstoning comments deleted on GitHub.

Environment:

- `MULTICA_CLI_PATH` (required) — the Multica CLI executable for this runtime.
- `GH_TOKEN` (optional) — falls back to `gh auth token`.

## Output and exit codes

Stdout summary line (non-`--json`):

```
comments_added=A comments_updated=U comments_tombstoned=T skipped=S errors=E dry_run=false issues=<candidate count>
```

| Code | Meaning |
|---|---|
| 0 | success, including no changes |
| 1 | unexpected internal error |
| 2 | config/auth error (`MULTICA_CLI_PATH` missing, `gh` not logged in, project missing) |
| 3 | partial failure (`errors=N` in the summary) |
| 4 | retryable transient failure (GitHub 403/429, Multica 5xx) after bounded retries |
| 5 | bad arguments |

## Tests

```bash
python3 -m unittest discover -s .multica/sync -p 'test_*.py'
```

The tests are offline: they cover the three-way diff, tombstone idempotence,
body rendering and the revision-conflict retry path.
