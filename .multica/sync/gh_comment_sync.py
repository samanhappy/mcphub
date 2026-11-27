#!/usr/bin/env python3
"""Mirror GitHub issue comments into their Multica issue counterparts.

The GitHub side is read-only: this script only issues GET requests against the
GitHub REST API. All writes go to Multica comments.

Identity of a mirrored comment is its marker ``<!-- gh-comment:<github id> -->``.
Reconciliation is three-way:

* GitHub has the comment, Multica has no marker   -> add
* both sides exist but the rebuilt body differs    -> update (mirror semantics)
* Multica has a marker, GitHub no longer has it    -> tombstone (never delete)

Every rebuilt body is a deterministic function of the GitHub comment, so a
second run over unchanged data plans zero writes.

Only the Python standard library is used. See README.md for usage.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

DEFAULT_REPO = "samanhappy/mcphub"
DEFAULT_PROJECT_ID = "1ce070d8-2888-443c-b1ac-db310ed7cd29"
DEFAULT_WINDOW_HOURS = 48
DEFAULT_MAX_WRITES = 50

GITHUB_API_URL = "https://api.github.com"
GITHUB_PAGE_SIZE = 100
GITHUB_MAX_PAGES = 100
HTTP_ATTEMPTS = 3
MULTICA_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = (1.0, 2.0)
REQUEST_TIMEOUT_SECONDS = 30
MULTICA_TIMEOUT_SECONDS = 180
FETCH_WORKERS = 8

MARKER_PATTERN = re.compile(r"<!-- gh-comment:(\d+) -->")
TOMBSTONE_BODY = "_（该评论已在 GitHub 删除，内容不再可用）_"
EMPTY_BODY = "（空评论）"
USER_AGENT = "mcphub-gh-comment-sync/1.0"
REPO_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")

ACTION_ADD = "add"
ACTION_UPDATE = "update"
ACTION_TOMBSTONE = "tombstone"


# ---------------------------------------------------------------------------
# Errors and exit codes
# ---------------------------------------------------------------------------


class SyncError(RuntimeError):
    """Unexpected failure (exit code 1)."""

    exit_code = 1
    retryable = False


class ConfigError(SyncError):
    """Missing configuration or failed authentication (exit code 2)."""

    exit_code = 2


class UsageError(SyncError):
    """Invalid command line arguments (exit code 5)."""

    exit_code = 5


class TransientError(SyncError):
    """Rate limit or server-side failure after bounded retries (exit code 4)."""

    exit_code = 4
    retryable = True


# ---------------------------------------------------------------------------
# Body rendering (pure)
# ---------------------------------------------------------------------------


def format_timestamp(value: Any) -> str:
    """Render a GitHub ISO-8601 timestamp as ``YYYY-MM-DD HH:MM UTC``."""

    text = str(value or "").strip()
    if not text:
        raise SyncError("GitHub comment is missing created_at")
    normalized = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise SyncError(f"unparsable GitHub timestamp: {text!r}") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def escape_mentions(text: str) -> str:
    """Keep mirrored bodies from triggering Multica mentions."""

    return text.replace("mention://", "mention\\://")


def build_comment_body(comment: Dict[str, Any]) -> str:
    """Rebuild the Multica body for one GitHub issue comment.

    Must stay byte-for-byte identical to comments already mirrored by earlier
    runs: ``created_at`` (never ``updated_at``), raw body, same marker.
    """

    try:
        github_id = int(comment["id"])
    except (KeyError, TypeError, ValueError) as exc:
        raise SyncError("GitHub comment without a numeric id") from exc
    login = ((comment.get("user") or {}).get("login")) or "unknown"
    html_url = comment.get("html_url") or ""
    header = (
        f"> GitHub 评论 · 作者 `@{login}` · {format_timestamp(comment.get('created_at'))}"
        f" · [原评论]({html_url})"
    )
    body = comment.get("body") or ""
    if not body.strip():
        body = EMPTY_BODY
    return f"{header}\n\n{escape_mentions(body)}\n\n<!-- gh-comment:{github_id} -->"


def build_tombstone_body(content: str) -> str:
    """Keep the original banner line and marker, replace the body."""

    marker = MARKER_PATTERN.search(content or "")
    if marker is None:
        raise SyncError("cannot tombstone a comment without a gh-comment marker")
    header = (content or "").split("\n", 1)[0].rstrip("\r")
    if not header:
        raise SyncError("cannot tombstone a comment with an empty banner line")
    return f"{header}\n\n{TOMBSTONE_BODY}\n\n<!-- gh-comment:{int(marker.group(1))} -->"


def is_tombstone(content: Optional[str]) -> bool:
    return TOMBSTONE_BODY in (content or "")


def marker_for(content: Optional[str]) -> Optional[int]:
    match = MARKER_PATTERN.search(content or "")
    return int(match.group(1)) if match else None


def index_mirrors(comments: Iterable[Dict[str, Any]]) -> Dict[int, Dict[str, Any]]:
    """Index Multica comments by marker, keeping the oldest on duplicates."""

    index: Dict[int, Dict[str, Any]] = {}
    for comment in comments or []:
        github_id = marker_for(comment.get("content"))
        if github_id is None:
            continue
        existing = index.get(github_id)
        if existing is None or (comment.get("created_at") or "") < (
            existing.get("created_at") or ""
        ):
            index[github_id] = comment
    return index


# ---------------------------------------------------------------------------
# Diff planning (pure)
# ---------------------------------------------------------------------------


@dataclass
class WriteOperation:
    action: str
    issue_number: int
    issue_id: str
    github_comment_id: int
    body: str
    comment_id: Optional[str] = None
    revision: Optional[int] = None

    def describe(self) -> str:
        return (
            f"{self.action} #{self.issue_number} gh-comment:{self.github_comment_id}"
        )


@dataclass
class IssuePlan:
    writes: List[WriteOperation] = field(default_factory=list)
    skipped: int = 0
    errors: List[Dict[str, Any]] = field(default_factory=list)


def plan_issue(
    issue_number: int,
    issue_id: str,
    github_comments: Sequence[Dict[str, Any]],
    mirror_comments: Sequence[Dict[str, Any]],
    delete_reconcile: bool = True,
) -> IssuePlan:
    """Compute the writes needed to align one issue's comments."""

    plan = IssuePlan()
    mirrors = index_mirrors(mirror_comments)

    github_by_id: Dict[int, Dict[str, Any]] = {}
    for comment in github_comments or []:
        try:
            github_by_id[int(comment["id"])] = comment
        except (KeyError, TypeError, ValueError):
            plan.errors.append(
                {
                    "issue": issue_number,
                    "action": None,
                    "github_comment_id": None,
                    "error": "GitHub comment without a numeric id",
                }
            )

    for github_id in sorted(github_by_id):
        comment = github_by_id[github_id]
        try:
            desired = build_comment_body(comment)
        except SyncError as exc:
            plan.errors.append(
                {
                    "issue": issue_number,
                    "action": None,
                    "github_comment_id": github_id,
                    "error": str(exc),
                }
            )
            continue

        existing = mirrors.get(github_id)
        if existing is None:
            plan.writes.append(
                WriteOperation(
                    action=ACTION_ADD,
                    issue_number=issue_number,
                    issue_id=issue_id,
                    github_comment_id=github_id,
                    body=desired,
                )
            )
            continue

        current = existing.get("content") or ""
        if current == desired:
            plan.skipped += 1
            continue
        if is_tombstone(current):
            # Marker is the identity: a tombstone stays put even if GitHub
            # somehow returns an older comment with the same id.
            plan.skipped += 1
            continue
        plan.writes.append(
            WriteOperation(
                action=ACTION_UPDATE,
                issue_number=issue_number,
                issue_id=issue_id,
                github_comment_id=github_id,
                body=desired,
                comment_id=existing.get("id"),
                revision=int(existing.get("revision") or 0),
            )
        )

    if delete_reconcile:
        for github_id in sorted(set(mirrors) - set(github_by_id)):
            existing = mirrors[github_id]
            current = existing.get("content") or ""
            if is_tombstone(current):
                plan.skipped += 1
                continue
            try:
                desired = build_tombstone_body(current)
            except SyncError as exc:
                plan.errors.append(
                    {
                        "issue": issue_number,
                        "action": None,
                        "github_comment_id": github_id,
                        "error": str(exc),
                    }
                )
                continue
            plan.writes.append(
                WriteOperation(
                    action=ACTION_TOMBSTONE,
                    issue_number=issue_number,
                    issue_id=issue_id,
                    github_comment_id=github_id,
                    body=desired,
                    comment_id=existing.get("id"),
                    revision=int(existing.get("revision") or 0),
                )
            )

    return plan


# ---------------------------------------------------------------------------
# GitHub reads (GET only)
# ---------------------------------------------------------------------------


def resolve_github_token() -> str:
    """Use GH_TOKEN, else the token from a logged-in ``gh`` CLI."""

    token = os.environ.get("GH_TOKEN", "").strip()
    if token:
        return token
    try:
        completed = subprocess.run(
            ["gh", "auth", "token"],
            capture_output=True,
            text=True,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as exc:
        raise ConfigError(
            "GH_TOKEN is not set and the `gh` CLI is not installed; "
            "run `gh auth login` or set GH_TOKEN"
        ) from exc
    except (subprocess.SubprocessError, OSError) as exc:
        raise ConfigError(f"could not read `gh auth token`: {exc}") from exc
    token = (completed.stdout or "").strip()
    if completed.returncode != 0 or not token:
        detail = (completed.stderr or "").strip()
        raise ConfigError(
            "GitHub authentication unavailable: set GH_TOKEN or run `gh auth login`"
            + (f" ({detail})" if detail else "")
        )
    return token


def _next_link(link_header: Optional[str]) -> str:
    if not link_header:
        return ""
    for part in link_header.split(","):
        section = part.strip()
        if 'rel="next"' in section:
            start = section.find("<")
            end = section.find(">")
            if start != -1 and end > start:
                return section[start + 1 : end]
    return ""


def _http_error_detail(exc: urllib.error.HTTPError) -> str:
    try:
        raw = exc.read() or b""
    except Exception:  # pragma: no cover - defensive
        raw = b""
    text = raw.decode("utf-8", "replace").strip()
    return text[:500] if text else (exc.reason or "")


class GitHubClient:
    def __init__(self, token: str):
        self._token = token

    def _get(self, url: str) -> Tuple[Any, str]:
        headers = {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {self._token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": USER_AGENT,
        }
        last_error: Optional[SyncError] = None
        for attempt in range(HTTP_ATTEMPTS):
            request = urllib.request.Request(url, headers=headers, method="GET")
            try:
                with urllib.request.urlopen(
                    request, timeout=REQUEST_TIMEOUT_SECONDS
                ) as response:
                    payload = response.read()
                    data = json.loads(payload.decode("utf-8")) if payload else None
                    return data, response.headers.get("Link", "")
            except urllib.error.HTTPError as exc:
                detail = _http_error_detail(exc)
                if exc.code == 401:
                    raise ConfigError(
                        f"GitHub rejected the token (401): {detail}"
                    ) from exc
                if exc.code in (403, 429):
                    last_error = TransientError(
                        f"GitHub rate limit or forbidden response ({exc.code}): {detail}"
                    )
                elif 500 <= exc.code < 600:
                    last_error = TransientError(
                        f"GitHub server error ({exc.code}): {detail}"
                    )
                else:
                    raise SyncError(
                        f"GitHub GET {url} failed with {exc.code}: {detail}"
                    ) from exc
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                last_error = TransientError(f"GitHub request failed for {url}: {exc}")

            if attempt < HTTP_ATTEMPTS - 1:
                time.sleep(
                    RETRY_BACKOFF_SECONDS[min(attempt, len(RETRY_BACKOFF_SECONDS) - 1)]
                )

        assert last_error is not None
        raise last_error

    def get_all(self, path: str, params: Optional[Dict[str, Any]] = None) -> List[Any]:
        query = dict(params or {})
        query.setdefault("per_page", GITHUB_PAGE_SIZE)
        url = f"{GITHUB_API_URL}{path}?{urllib.parse.urlencode(query)}"
        items: List[Any] = []
        for _ in range(GITHUB_MAX_PAGES):
            data, link = self._get(url)
            if not isinstance(data, list):
                raise SyncError(f"expected a JSON list from {url}")
            items.extend(data)
            url = _next_link(link)
            if not url:
                return items
        raise SyncError(f"pagination exceeded {GITHUB_MAX_PAGES} pages for {path}")


def collect_candidate_numbers(
    github: GitHubClient, repo: str, window_hours: int
) -> List[int]:
    """Open issues plus issues updated inside the window, deduped by number."""

    numbers = set()
    open_issues = github.get_all(
        f"/repos/{repo}/issues",
        {"state": "open", "sort": "updated", "direction": "desc"},
    )
    since = (datetime.now(timezone.utc) - timedelta(hours=window_hours)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    recent_issues = github.get_all(
        f"/repos/{repo}/issues",
        {
            "state": "all",
            "sort": "updated",
            "direction": "desc",
            "since": since,
        },
    )
    for item in list(open_issues) + list(recent_issues):
        if not isinstance(item, dict):
            continue
        if "pull_request" in item:  # the REST issues endpoint mixes PRs in
            continue
        number = item.get("number")
        if isinstance(number, int):
            numbers.add(number)
    return sorted(numbers)


# ---------------------------------------------------------------------------
# Multica CLI
# ---------------------------------------------------------------------------


def _looks_transient(stderr: str) -> bool:
    lowered = stderr.lower()
    needles = (
        "timeout",
        "deadline exceeded",
        "temporarily unavailable",
        "service unavailable",
        "bad gateway",
        "internal server error",
        "connection reset",
        "connection refused",
        "rate limit",
        "too many requests",
        "try again",
        " 500",
        " 502",
        " 503",
        " 504",
    )
    return any(needle in lowered for needle in needles)


def _looks_like_auth_error(stderr: str) -> bool:
    lowered = stderr.lower()
    return any(
        needle in lowered
        for needle in ("unauthorized", "not authenticated", "invalid api key", "401")
    )


def _looks_like_not_found(stderr: str) -> bool:
    lowered = stderr.lower()
    return "not found" in lowered or "404" in lowered


@contextlib.contextmanager
def _content_file(text: str):
    """Write content to a temp file inside the CWD (required by the CLI)."""

    handle, path = tempfile.mkstemp(
        prefix=".gh-comment-sync-", suffix=".md", dir=os.getcwd()
    )
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="") as stream:
            stream.write(text)
        yield path
    finally:
        try:
            os.unlink(path)
        except OSError:  # pragma: no cover - defensive
            pass


class MulticaClient:
    def __init__(self, cli_path: str):
        self.cli_path = cli_path

    def _run(
        self,
        args: Sequence[str],
        label: str,
        *,
        not_found_is_config: bool = False,
    ) -> subprocess.CompletedProcess:
        command = [self.cli_path, *args]
        last_error: Optional[SyncError] = None
        for attempt in range(MULTICA_ATTEMPTS):
            try:
                completed = subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    timeout=MULTICA_TIMEOUT_SECONDS,
                )
            except subprocess.TimeoutExpired:
                last_error = TransientError(f"{label}: multica CLI timed out")
                completed = None
            except FileNotFoundError as exc:
                raise ConfigError(
                    f"MULTICA_CLI_PATH is not executable: {self.cli_path}"
                ) from exc
            except OSError as exc:
                raise ConfigError(
                    f"could not run MULTICA_CLI_PATH ({self.cli_path}): {exc}"
                ) from exc

            if completed is not None and completed.returncode == 0:
                return completed

            if completed is not None:
                stderr = (completed.stderr or "").strip()
                message = (
                    f"{label} failed (multica exit {completed.returncode}): "
                    f"{stderr[:1000]}"
                )
                if not_found_is_config and _looks_like_not_found(stderr):
                    raise ConfigError(message)
                if _looks_like_auth_error(stderr):
                    raise ConfigError(message)
                if _looks_transient(stderr):
                    last_error = TransientError(message)
                else:
                    raise SyncError(message)

            if attempt < MULTICA_ATTEMPTS - 1:
                time.sleep(
                    RETRY_BACKOFF_SECONDS[min(attempt, len(RETRY_BACKOFF_SECONDS) - 1)]
                )

        assert last_error is not None
        raise last_error

    def get_project(self, project_id: str) -> Dict[str, Any]:
        """Fail with exit code 2 when the project does not exist."""

        completed = self._run(
            ["project", "get", project_id, "--output", "json"],
            f"project get {project_id}",
            not_found_is_config=True,
        )
        try:
            payload = json.loads(completed.stdout or "{}")
        except ValueError as exc:
            raise SyncError(
                f"unexpected project payload for {project_id}: {completed.stdout[:200]!r}"
            ) from exc
        return payload if isinstance(payload, dict) else {}

    def list_project_issues(self, project_id: str) -> List[Dict[str, Any]]:
        issues: List[Dict[str, Any]] = []
        offset = 0
        for _ in range(100):
            completed = self._run(
                [
                    "issue",
                    "list",
                    "--project",
                    project_id,
                    "--limit",
                    "100",
                    "--offset",
                    str(offset),
                    "--output",
                    "json",
                ],
                f"issue list for project {project_id}",
                not_found_is_config=True,
            )
            payload = json.loads(completed.stdout or "{}")
            page = payload.get("issues") or []
            issues.extend(page)
            if not payload.get("has_more") or not page:
                return issues
            offset += len(page)
        raise SyncError("issue list pagination exceeded 100 pages")

    def list_comments(self, issue_id: str) -> List[Dict[str, Any]]:
        completed = self._run(
            ["issue", "comment", "list", issue_id, "--full", "--output", "json"],
            f"comment list for issue {issue_id}",
        )
        payload = json.loads(completed.stdout or "[]")
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict):
            return payload.get("comments") or []
        raise SyncError(f"unexpected comment list payload for issue {issue_id}")

    def add_comment(self, issue_id: str, body: str, idempotency_key: str) -> None:
        with _content_file(body) as path:
            self._run(
                [
                    "issue",
                    "comment",
                    "add",
                    issue_id,
                    "--content-file",
                    path,
                    "--idempotency-key",
                    idempotency_key,
                    "--output",
                    "json",
                ],
                f"comment add for issue {issue_id}",
            )

    def update_comment(self, comment_id: str, body: str, revision: int) -> None:
        with _content_file(body) as path:
            self._run(
                [
                    "issue",
                    "comment",
                    "update",
                    comment_id,
                    "--content-file",
                    path,
                    "--expected-revision",
                    str(revision),
                    "--output",
                    "json",
                ],
                f"comment update for {comment_id}",
            )


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------


@dataclass
class RunResult:
    dry_run: bool = False
    candidates: int = 0
    github_candidates: int = 0
    added: int = 0
    updated: int = 0
    tombstoned: int = 0
    skipped: int = 0
    deferred: int = 0
    writes_planned: int = 0
    errors: List[Dict[str, Any]] = field(default_factory=list)
    retryable: bool = False

    def record_error(
        self,
        issue_number: Optional[int],
        action: Optional[str],
        github_comment_id: Optional[int],
        message: str,
        retryable: bool = False,
    ) -> None:
        self.errors.append(
            {
                "issue": issue_number,
                "action": action,
                "github_comment_id": github_comment_id,
                "error": message,
            }
        )
        self.retryable = self.retryable or retryable


def log(message: str) -> None:
    sys.stderr.write(message + "\n")
    sys.stderr.flush()


def _metadata_number(issue: Dict[str, Any]) -> Optional[int]:
    metadata = issue.get("metadata") or {}
    value = metadata.get("github_number")
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _apply_add(client: MulticaClient, write: WriteOperation) -> Tuple[bool, str, bool]:
    key = f"gh-comment-sync:{write.issue_id}:{write.github_comment_id}"
    try:
        client.add_comment(write.issue_id, write.body, key)
        return True, "", False
    except ConfigError:
        raise
    except SyncError as exc:
        return False, str(exc), exc.retryable


def _apply_update(client: MulticaClient, write: WriteOperation) -> Tuple[bool, str, bool]:
    """Update with a revision check; on rejection reload once and retry."""

    assert write.comment_id is not None
    try:
        client.update_comment(write.comment_id, write.body, int(write.revision or 0))
        return True, "", False
    except ConfigError:
        raise
    except SyncError as first:
        try:
            comments = client.list_comments(write.issue_id)
        except ConfigError:
            raise
        except SyncError as reload_error:
            return (
                False,
                f"{first}; reload failed: {reload_error}",
                first.retryable or reload_error.retryable,
            )

        current = index_mirrors(comments).get(write.github_comment_id)
        if current is None:
            return False, f"{first}; comment disappeared after reload", first.retryable
        content = current.get("content") or ""
        if content == write.body:
            return True, "", False
        if write.action == ACTION_UPDATE and is_tombstone(content):
            return True, "", False
        try:
            client.update_comment(
                current["id"], write.body, int(current.get("revision") or 0)
            )
            return True, "", False
        except ConfigError:
            raise
        except SyncError as second:
            return False, str(second), second.retryable


def _run_write(client: MulticaClient, write: WriteOperation) -> Tuple[bool, str, bool]:
    if write.action == ACTION_ADD:
        return _apply_add(client, write)
    return _apply_update(client, write)


def _emit(result: RunResult, json_mode: bool) -> None:
    if json_mode:
        payload = {
            "comments_added": result.added,
            "comments_updated": result.updated,
            "comments_tombstoned": result.tombstoned,
            "skipped": result.skipped,
            "errors": len(result.errors),
            "deferred": result.deferred,
            "dry_run": result.dry_run,
            "issues": result.candidates,
            "github_candidates": result.github_candidates,
            "writes_planned": result.writes_planned,
            "error_details": result.errors,
        }
        sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    else:
        sys.stdout.write(
            f"comments_added={result.added} "
            f"comments_updated={result.updated} "
            f"comments_tombstoned={result.tombstoned} "
            f"skipped={result.skipped} "
            f"errors={len(result.errors)} "
            f"dry_run={'true' if result.dry_run else 'false'} "
            f"issues={result.candidates}\n"
        )
    sys.stdout.flush()


def _fetch_issue_comments(
    github: GitHubClient,
    multica: MulticaClient,
    repo: str,
    number: int,
    issue_id: str,
) -> Tuple[Any, Any, Optional[Tuple[str, SyncError]]]:
    """Read both sides for one issue; errors come back instead of raising."""

    try:
        github_comments = github.get_all(f"/repos/{repo}/issues/{number}/comments")
    except ConfigError:
        raise
    except SyncError as exc:
        return None, None, ("GitHub comments fetch failed", exc)

    try:
        mirror_comments = multica.list_comments(issue_id)
    except ConfigError:
        raise
    except SyncError as exc:
        return None, None, ("Multica comments fetch failed", exc)

    return github_comments, mirror_comments, None


def run(args: argparse.Namespace) -> RunResult:
    result = RunResult(dry_run=args.dry_run)

    cli_path = os.environ.get("MULTICA_CLI_PATH", "").strip()
    if not cli_path:
        raise ConfigError("MULTICA_CLI_PATH is not set")
    if not (os.path.isfile(cli_path) and os.access(cli_path, os.X_OK)):
        raise ConfigError(f"MULTICA_CLI_PATH is not executable: {cli_path}")

    multica = MulticaClient(cli_path)
    multica.get_project(args.project_id)
    mirror_index: Dict[int, Dict[str, Any]] = {}
    for issue in multica.list_project_issues(args.project_id):
        number = _metadata_number(issue)
        if number is None:
            continue
        existing = mirror_index.get(number)
        if existing is None or (issue.get("created_at") or "") < (
            existing.get("created_at") or ""
        ):
            mirror_index[number] = issue

    github = GitHubClient(resolve_github_token())
    if args.issues:
        numbers = list(args.issues)
    else:
        numbers = collect_candidate_numbers(github, args.repo, args.window_hours)
    result.github_candidates = len(numbers)

    targets = []
    for number in numbers:
        issue = mirror_index.get(number)
        if issue is None:
            log(f"[sync] #{number}: no Multica mirror, skipped")
            continue
        targets.append((number, issue))
    result.candidates = len(targets)

    # Reads are independent per issue, so fetch them concurrently; writes below
    # stay sequential so revision checks keep their meaning.
    plans: List[IssuePlan] = []
    if targets:
        with ThreadPoolExecutor(max_workers=min(FETCH_WORKERS, len(targets))) as pool:
            futures = {
                number: pool.submit(
                    _fetch_issue_comments,
                    github,
                    multica,
                    args.repo,
                    number,
                    issue["id"],
                )
                for number, issue in targets
            }
            for number, issue in targets:
                issue_id = issue["id"]
                try:
                    github_comments, mirror_comments, fetch_error = futures[
                        number
                    ].result()
                except ConfigError:
                    raise
                except SyncError as exc:
                    result.record_error(
                        number, None, None, f"comment fetch failed: {exc}", exc.retryable
                    )
                    continue

                if fetch_error is not None:
                    prefix, exc = fetch_error
                    result.record_error(
                        number, None, None, f"{prefix}: {exc}", exc.retryable
                    )
                    continue

                plan = plan_issue(
                    number,
                    issue_id,
                    github_comments,
                    mirror_comments,
                    delete_reconcile=not args.no_delete_reconcile,
                )
                result.skipped += plan.skipped
                for error in plan.errors:
                    result.record_error(
                        error["issue"],
                        error["action"],
                        error["github_comment_id"],
                        error["error"],
                    )
                plans.append(plan)
                log(
                    f"[sync] #{number}: gh={len(github_comments)} "
                    f"mirrored={len(mirror_comments)} planned={len(plan.writes)} "
                    f"skipped={plan.skipped}"
                )

    writes = [write for plan in plans for write in plan.writes]
    result.writes_planned = len(writes)
    selected = writes[: args.max_writes]
    result.deferred = len(writes) - len(selected)
    if result.deferred:
        log(f"[sync] deferred {result.deferred} writes to the next run")

    if args.dry_run:
        for write in selected:
            if write.action == ACTION_ADD:
                result.added += 1
            elif write.action == ACTION_UPDATE:
                result.updated += 1
            else:
                result.tombstoned += 1
        for write in writes:
            log(f"[sync] plan: {write.describe()}")
        return result

    for write in selected:
        try:
            ok, message, retryable = _run_write(multica, write)
        except ConfigError:
            raise
        except SyncError as exc:
            result.record_error(
                write.issue_number, write.action, write.github_comment_id, str(exc),
                exc.retryable,
            )
            continue
        if not ok:
            result.record_error(
                write.issue_number, write.action, write.github_comment_id, message,
                retryable,
            )
            continue
        if write.action == ACTION_ADD:
            result.added += 1
        elif write.action == ACTION_UPDATE:
            result.updated += 1
        else:
            result.tombstoned += 1

    return result


# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------


class _Parser(argparse.ArgumentParser):
    """argparse with exit code 5 for argument errors."""

    def error(self, message: str) -> None:  # type: ignore[override]
        raise UsageError(message)


def _positive_int(value: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise argparse.ArgumentTypeError(f"expected an integer, got {value!r}") from exc
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


def _issue_numbers(value: str) -> List[int]:
    numbers = []
    for part in value.split(","):
        part = part.strip()
        if not part:
            raise argparse.ArgumentTypeError(
                f"invalid --issues value {value!r}: empty issue number"
            )
        try:
            number = int(part)
        except ValueError as exc:
            raise argparse.ArgumentTypeError(
                f"invalid --issues value {value!r}: {part!r} is not a number"
            ) from exc
        if number <= 0:
            raise argparse.ArgumentTypeError(
                f"invalid --issues value {value!r}: issue numbers must be positive"
            )
        numbers.append(number)
    if not numbers:
        raise argparse.ArgumentTypeError("--issues needs at least one issue number")
    return sorted(set(numbers))


def _repo_slug(value: str) -> str:
    if not REPO_PATTERN.match(value or ""):
        raise argparse.ArgumentTypeError(
            f"invalid --repo value {value!r}, expected owner/name"
        )
    return value


def build_parser() -> _Parser:
    parser = _Parser(
        prog="gh_comment_sync.py",
        description="Mirror GitHub issue comments into Multica (read-only GitHub).",
    )
    parser.add_argument("--repo", type=_repo_slug, default=DEFAULT_REPO)
    parser.add_argument("--project-id", default=DEFAULT_PROJECT_ID)
    parser.add_argument(
        "--window-hours", type=_positive_int, default=DEFAULT_WINDOW_HOURS
    )
    parser.add_argument("--issues", type=_issue_numbers, default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--json", action="store_true", dest="json_output")
    parser.add_argument("--max-writes", type=_positive_int, default=DEFAULT_MAX_WRITES)
    parser.add_argument("--no-delete-reconcile", action="store_true")
    return parser


def _exit_code(result: RunResult) -> int:
    """0 success, 3 partial failure, 4 retryable transient failure."""

    if not result.errors:
        return 0
    return 4 if result.retryable else 3


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
    except UsageError as exc:
        sys.stderr.write(f"error: {exc}\n")
        sys.stderr.write(parser.format_usage())
        return UsageError.exit_code

    try:
        result = run(args)
    except ConfigError as exc:
        log(f"error: {exc}")
        return ConfigError.exit_code
    except (TransientError, SyncError) as exc:
        result = RunResult(dry_run=args.dry_run)
        result.record_error(None, None, None, str(exc), exc.retryable)
        _emit(result, args.json_output)
        return exc.exit_code
    except KeyboardInterrupt:  # pragma: no cover - interactive only
        log("interrupted")
        return 1
    except Exception as exc:  # unexpected internal error
        log(f"unexpected error: {exc!r}")
        return 1

    _emit(result, args.json_output)
    if result.errors:
        for error in result.errors:
            log(
                "[sync] error: issue={issue} action={action} "
                "gh-comment={github_comment_id}: {error}".format(**error)
            )
    return _exit_code(result)


if __name__ == "__main__":
    sys.exit(main())
