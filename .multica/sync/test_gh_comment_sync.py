#!/usr/bin/env python3
"""Unit tests for gh_comment_sync.

No network and no Multica CLI calls: everything here exercises the pure diff
and rendering helpers plus argument/exit-code handling.
"""

import argparse
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import gh_comment_sync as sync  # noqa: E402


def github_comment(
    comment_id=7216082413,
    login="samanhappy",
    created_at="2026-11-27T10:36:08Z",
    updated_at="2026-12-01T09:00:00Z",
    body="Thanks for sharing the logs!",
    html_url=None,
):
    return {
        "id": comment_id,
        "user": {"login": login},
        "created_at": created_at,
        "updated_at": updated_at,
        "body": body,
        "html_url": html_url
        or f"https://github.com/samanhappy/mcphub/issues/1582#issuecomment-{comment_id}",
    }


def mirror_comment(content, comment_id="mirror-1", revision=1, created_at="2026-11-27T14:40:01Z"):
    return {
        "id": comment_id,
        "content": content,
        "revision": revision,
        "created_at": created_at,
    }


BANNER = (
    "> GitHub 评论 · 作者 `@samanhappy` · 2026-11-27 10:36 UTC"
    " · [原评论](https://github.com/samanhappy/mcphub/issues/1582#issuecomment-7216082413)"
)


class BuildCommentBodyTests(unittest.TestCase):
    def test_matches_existing_mirror_byte_for_byte(self):
        comment = github_comment(body="Thanks for sharing the logs!")
        self.assertEqual(
            sync.build_comment_body(comment),
            f"{BANNER}\n\nThanks for sharing the logs!\n\n<!-- gh-comment:7216082413 -->",
        )

    def test_preserves_trailing_newline_of_body(self):
        comment = github_comment(body="Line.\n")
        self.assertTrue(
            sync.build_comment_body(comment).startswith(f"{BANNER}\n\nLine.\n\n\n<!-- gh-comment:")
        )

    def test_uses_created_at_not_updated_at(self):
        comment = github_comment(created_at="2026-11-27T10:36:08Z", updated_at="2026-12-01T09:00:00Z")
        body = sync.build_comment_body(comment)
        self.assertIn("2026-11-27 10:36 UTC", body)
        self.assertNotIn("2026-12-01", body)

    def test_escapes_mention_scheme_but_keeps_handles_plain(self):
        comment = github_comment(body="ping @alice via mention://member/abc")
        body = sync.build_comment_body(comment)
        self.assertIn("mention\\://member/abc", body)
        self.assertIn("@alice", body)
        self.assertNotIn("@[", body)

    def test_empty_body_placeholder(self):
        comment = github_comment(body="   \n")
        body = sync.build_comment_body(comment)
        self.assertIn(f"\n\n{sync.EMPTY_BODY}\n\n", body)

    def test_rebuild_is_deterministic(self):
        comment = github_comment(body="Same input.")
        self.assertEqual(sync.build_comment_body(comment), sync.build_comment_body(comment))


class TombstoneTests(unittest.TestCase):
    def setUp(self):
        self.existing = (
            f"{BANNER}\n\nOriginal text.\n\n<!-- gh-comment:7216082413 -->"
        )

    def test_keeps_banner_and_marker(self):
        tombstone = sync.build_tombstone_body(self.existing)
        self.assertEqual(
            tombstone,
            f"{BANNER}\n\n{sync.TOMBSTONE_BODY}\n\n<!-- gh-comment:7216082413 -->",
        )

    def test_tombstone_is_detected(self):
        self.assertTrue(sync.is_tombstone(sync.build_tombstone_body(self.existing)))
        self.assertFalse(sync.is_tombstone(self.existing))

    def test_rejects_content_without_marker(self):
        with self.assertRaises(sync.SyncError):
            sync.build_tombstone_body("no marker here")


class PlanIssueTests(unittest.TestCase):
    def test_adds_github_comment_without_mirror(self):
        plan = sync.plan_issue(
            1582, "issue-1", [github_comment()], [], delete_reconcile=True
        )
        self.assertEqual(len(plan.writes), 1)
        self.assertEqual(plan.writes[0].action, sync.ACTION_ADD)
        self.assertEqual(plan.writes[0].github_comment_id, 7216082413)
        self.assertEqual(plan.skipped, 0)
        self.assertFalse(plan.errors)

    def test_updates_changed_body(self):
        stale = f"{BANNER}\n\nOld text.\n\n<!-- gh-comment:7216082413 -->"
        plan = sync.plan_issue(
            1582,
            "issue-1",
            [github_comment(body="New text.")],
            [mirror_comment(stale, revision=3)],
        )
        self.assertEqual(len(plan.writes), 1)
        write = plan.writes[0]
        self.assertEqual(write.action, sync.ACTION_UPDATE)
        self.assertEqual(write.comment_id, "mirror-1")
        self.assertEqual(write.revision, 3)
        self.assertIn("New text.", write.body)

    def test_identical_body_is_skipped(self):
        current = sync.build_comment_body(github_comment(body="New text."))
        plan = sync.plan_issue(
            1582, "issue-1", [github_comment(body="New text.")],
            [mirror_comment(current)],
        )
        self.assertEqual(plan.writes, [])
        self.assertEqual(plan.skipped, 1)

    def test_tombstones_comment_deleted_on_github(self):
        stale = f"{BANNER}\n\nGone.\n\n<!-- gh-comment:999 -->"
        plan = sync.plan_issue(
            1582, "issue-1", [], [mirror_comment(stale, comment_id="mirror-9")]
        )
        self.assertEqual(len(plan.writes), 1)
        write = plan.writes[0]
        self.assertEqual(write.action, sync.ACTION_TOMBSTONE)
        self.assertEqual(write.github_comment_id, 999)
        self.assertEqual(write.comment_id, "mirror-9")
        self.assertIn(sync.TOMBSTONE_BODY, write.body)
        self.assertTrue(write.body.startswith(BANNER))

    def test_existing_tombstone_is_skipped_idempotently(self):
        tombstone = sync.build_tombstone_body(
            f"{BANNER}\n\nGone.\n\n<!-- gh-comment:999 -->"
        )
        plan = sync.plan_issue(1582, "issue-1", [], [mirror_comment(tombstone)])
        self.assertEqual(plan.writes, [])
        self.assertEqual(plan.skipped, 1)

    def test_marker_wins_over_missing_github_comment(self):
        """A tombstoned mirror is never re-created or re-updated."""

        tombstone = sync.build_tombstone_body(
            f"{BANNER}\n\nGone.\n\n<!-- gh-comment:7216082413 -->"
        )
        plan = sync.plan_issue(
            1582, "issue-1", [github_comment(body="Back?")],
            [mirror_comment(tombstone)],
        )
        self.assertEqual(plan.writes, [])
        self.assertEqual(plan.skipped, 1)

    def test_delete_reconcile_disabled_skips_tombstones(self):
        stale = f"{BANNER}\n\nGone.\n\n<!-- gh-comment:999 -->"
        plan = sync.plan_issue(
            1582, "issue-1", [], [mirror_comment(stale)], delete_reconcile=False
        )
        self.assertEqual(plan.writes, [])
        self.assertEqual(plan.skipped, 0)

    def test_multiple_actions_are_ordered_deterministically(self):
        existing = f"{BANNER}\n\nOld.\n\n<!-- gh-comment:100 -->"
        deleted = f"{BANNER}\n\nGone.\n\n<!-- gh-comment:50 -->"
        plan = sync.plan_issue(
            1582,
            "issue-1",
            [github_comment(comment_id=100, body="New."), github_comment(comment_id=200)],
            [mirror_comment(existing), mirror_comment(deleted, comment_id="mirror-2")],
        )
        self.assertEqual(
            [(w.action, w.github_comment_id) for w in plan.writes],
            [
                (sync.ACTION_UPDATE, 100),
                (sync.ACTION_ADD, 200),
                (sync.ACTION_TOMBSTONE, 50),
            ],
        )

    def test_duplicate_markers_keep_oldest_mirror(self):
        old = mirror_comment(
            f"{BANNER}\n\nNew.\n\n<!-- gh-comment:7216082413 -->",
            comment_id="old",
            created_at="2026-11-27T14:40:01Z",
        )
        new = mirror_comment(
            f"{BANNER}\n\nNew.\n\n<!-- gh-comment:7216082413 -->",
            comment_id="new",
            created_at="2026-11-28T00:00:00Z",
        )
        plan = sync.plan_issue(
            1582, "issue-1", [github_comment(body="New.")], [new, old]
        )
        self.assertEqual(plan.writes, [])
        self.assertEqual(plan.skipped, 1)


class ArgumentTests(unittest.TestCase):
    def test_issue_numbers_parse_and_dedupe(self):
        self.assertEqual(sync._issue_numbers(" 1582,1567,1582 "), [1567, 1582])

    def test_issue_numbers_reject_garbage(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            sync._issue_numbers("1582,abc")
        with self.assertRaises(argparse.ArgumentTypeError):
            sync._issue_numbers("1582,")
        with self.assertRaises(argparse.ArgumentTypeError):
            sync._issue_numbers("0")

    def test_max_writes_must_be_positive(self):
        with self.assertRaises(argparse.ArgumentTypeError):
            sync._positive_int("0")
        with self.assertRaises(argparse.ArgumentTypeError):
            sync._positive_int("-3")

    def test_repo_slug_validation(self):
        self.assertEqual(sync._repo_slug("samanhappy/mcphub"), "samanhappy/mcphub")
        with self.assertRaises(argparse.ArgumentTypeError):
            sync._repo_slug("mcphub")

    def test_unknown_argument_exits_5(self):
        self.assertEqual(sync.main(["--nope"]), 5)
        self.assertEqual(sync.main(["--max-writes", "0"]), 5)
        self.assertEqual(sync.main(["--issues", "x"]), 5)


class ConfigExitCodeTests(unittest.TestCase):
    def test_missing_multica_cli_path_exits_2(self):
        previous = os.environ.pop("MULTICA_CLI_PATH", None)
        try:
            self.assertEqual(sync.main(["--dry-run", "--issues", "1582"]), 2)
        finally:
            if previous is not None:
                os.environ["MULTICA_CLI_PATH"] = previous

    def test_non_executable_multica_cli_path_exits_2(self):
        previous = os.environ.get("MULTICA_CLI_PATH")
        os.environ["MULTICA_CLI_PATH"] = "/nonexistent/multica"
        try:
            self.assertEqual(sync.main(["--dry-run", "--issues", "1582"]), 2)
        finally:
            if previous is None:
                os.environ.pop("MULTICA_CLI_PATH", None)
            else:
                os.environ["MULTICA_CLI_PATH"] = previous


class FakeMulticaClient:
    """Minimal stand-in for MulticaClient used by the write-path tests."""

    def __init__(self, comments=None, update_failures=0, reload_error=None):
        self.comments = list(comments or [])
        self.update_failures = update_failures
        self.reload_error = reload_error
        self.adds = []
        self.updates = []

    def add_comment(self, issue_id, body, idempotency_key):
        self.adds.append((issue_id, body, idempotency_key))

    def update_comment(self, comment_id, body, revision):
        self.updates.append((comment_id, revision))
        if self.update_failures > 0:
            self.update_failures -= 1
            raise sync.SyncError("comment revision conflict")

    def list_comments(self, issue_id):
        if self.reload_error is not None:
            raise self.reload_error
        return self.comments


class ApplyAddTests(unittest.TestCase):
    def test_add_uses_stable_idempotency_key(self):
        client = FakeMulticaClient()
        write = sync.WriteOperation(
            action=sync.ACTION_ADD,
            issue_number=1582,
            issue_id="issue-1",
            github_comment_id=42,
            body="body",
        )
        self.assertEqual(sync._apply_add(client, write), (True, "", False))
        self.assertEqual(client.adds, [("issue-1", "body", "gh-comment-sync:issue-1:42")])


class ApplyUpdateTests(unittest.TestCase):
    def _write(self, action=sync.ACTION_UPDATE, body=None):
        return sync.WriteOperation(
            action=action,
            issue_number=1582,
            issue_id="issue-1",
            github_comment_id=7216082413,
            body=body or sync.build_comment_body(github_comment(body="New body.")),
            comment_id="mirror-1",
            revision=2,
        )

    def test_retries_once_with_fresh_revision_after_conflict(self):
        fresh = mirror_comment(
            f"{BANNER}\n\nOld body.\n\n<!-- gh-comment:7216082413 -->",
            comment_id="mirror-1",
            revision=5,
        )
        client = FakeMulticaClient(comments=[fresh], update_failures=1)
        self.assertEqual(sync._apply_update(client, self._write()), (True, "", False))
        self.assertEqual(client.updates, [("mirror-1", 2), ("mirror-1", 5)])

    def test_conflict_that_already_landed_is_success(self):
        desired = self._write().body
        client = FakeMulticaClient(
            comments=[mirror_comment(desired, revision=5)], update_failures=1
        )
        self.assertEqual(sync._apply_update(client, self._write()), (True, "", False))
        self.assertEqual(client.updates, [("mirror-1", 2)])

    def test_conflict_with_concurrent_tombstone_is_success(self):
        tombstone = sync.build_tombstone_body(
            f"{BANNER}\n\nOld.\n\n<!-- gh-comment:7216082413 -->"
        )
        client = FakeMulticaClient(
            comments=[mirror_comment(tombstone, revision=5)], update_failures=1
        )
        self.assertEqual(sync._apply_update(client, self._write()), (True, "", False))
        self.assertEqual(client.updates, [("mirror-1", 2)])

    def test_second_failure_is_reported(self):
        fresh = mirror_comment(
            f"{BANNER}\n\nOld body.\n\n<!-- gh-comment:7216082413 -->",
            revision=5,
        )
        client = FakeMulticaClient(comments=[fresh], update_failures=2)
        ok, message, retryable = sync._apply_update(client, self._write())
        self.assertFalse(ok)
        self.assertIn("revision conflict", message)
        self.assertFalse(retryable)

    def test_reload_failure_is_reported_as_retryable(self):
        client = FakeMulticaClient(
            update_failures=1, reload_error=sync.TransientError("multica 503")
        )
        ok, message, retryable = sync._apply_update(client, self._write())
        self.assertFalse(ok)
        self.assertIn("reload failed", message)
        self.assertTrue(retryable)

    def test_missing_marker_after_reload_is_reported(self):
        client = FakeMulticaClient(comments=[], update_failures=1)
        ok, message, _ = sync._apply_update(client, self._write())
        self.assertFalse(ok)
        self.assertIn("disappeared", message)


class ExitCodeTests(unittest.TestCase):
    def test_success_is_0(self):
        self.assertEqual(sync._exit_code(sync.RunResult()), 0)

    def test_partial_failure_is_3(self):
        result = sync.RunResult()
        result.record_error(1582, sync.ACTION_ADD, 1, "boom")
        self.assertEqual(sync._exit_code(result), 3)

    def test_transient_failure_is_4(self):
        result = sync.RunResult()
        result.record_error(1582, sync.ACTION_ADD, 1, "503", retryable=True)
        self.assertEqual(sync._exit_code(result), 4)


if __name__ == "__main__":
    unittest.main()
