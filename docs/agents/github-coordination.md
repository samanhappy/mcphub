# GitHub coordination (local-first)

[github-coordinator](../../.agents/skills/github-coordinator/SKILL.md) manages the whole queue. [github-worker](../../.agents/skills/github-worker/SKILL.md) owns one issue or PR task end to end. Read [triage labels](triage-labels.md) and [issue tracker](issue-tracker.md) for labels and implementation authorization.

## Roles and authority

- **Owner:** product direction, architecture/security decisions, implementation approval (including bounded standing approval), merge, release, and public external communication policy.
- **Coordinator:** triage, Type/Area/Priority/workflow labels, dependency and overlap checks, local queue state, task dispatch/resumption, and concise summaries. May set or revise ordinary priorities without per-issue approval, respecting explicit owner decisions. Does not implement product changes or perform deep per-task investigation.
- **Worker:** investigate, design, implement when authorized, test, open and follow up its PR, review external PRs, and return structured handoff evidence. Does not claim new work, edit the local queue state, set priority or workflow labels, approve implementation, or merge PRs.

Workflow labels identify **who acts next**, not task ownership. A tracked task retains its local binding (branch, PR, history) while waiting on owner decisions, PR review, contributor revisions, release, or verification.

## Task identity and linked artifacts

Every tracked task is keyed by its primary artifact: `issue#<N>` or `pr#<N>`. Confirm artifact type from the GitHub API since issues and PRs share a number namespace.

- An issue with a worker-created PR stays one task (`issue#<N>`). Record the PR under `related.pull_requests` and `pull_request`; never dispatch it as independent review work.
- A standalone external PR is a `pr#<N>` review task (no synthetic issue required). If it addresses an unclaimed issue, record that issue in `related.issues` under the same task. If the issue is already tracked, reconcile overlap before dispatching anything new.
- Competing PRs addressing the same issue belong to one conflict group under a single task for evaluation; never dispatch rival implementations.
- Incidental references and prerequisites are dependency links, not exclusive reservations. Record blocking dependencies and avoid splitting overlapping files or shared contracts across concurrent runs.
- Label each triaged issue and PR from its actual next action. Related artifacts can hold different labels (for example, a merged PR and an issue awaiting release verification). Labels never override local task tracking.

## Local state store

Coordinator state lives locally in `.agents/state/github-queue.json` (gitignored, private, never committed, and never posted to public GitHub comments). Optional per-task handoff notes may be saved in `.agents/state/tasks/<task-key>.md`.

If `.agents/state/github-queue.json` does not exist on the first run, the coordinator initializes it automatically:

```json
{
  "version": 1,
  "repository": "samanhappy/mcphub",
  "max_concurrent_runs": 2,
  "last_synced_at": "2026-11-26T01:30:00Z",
  "tasks": {
    "issue#1526": {
      "task": {"type": "issue", "number": 1526},
      "related": {"issues": [], "pull_requests": [1600]},
      "mode": "implementation",
      "status": "waiting",
      "authorization_ref": "owner chat approval 2026-11-26",
      "public_comment_mode": "draft_only",
      "run_id": "20261126-01",
      "runtime_ref": null,
      "branch": "feat/1526-bearer-key-expiry",
      "worktree": null,
      "pull_request": 1600,
      "reviewed_head_sha": null,
      "updated_at": "2026-11-26T01:30:00Z",
      "summary": "PR #1600 opened with expiry + isolated last_used writes",
      "next_trigger": "owner:review on PR #1600"
    }
  }
}
```

### State invariants

- **Task-keyed exclusivity:** each primary artifact and every number in `related.issues` / `related.pull_requests` belongs to at most one entry in `tasks`.
- **Concurrency without starvation:** `max_concurrent_runs` (default `2`, configurable by the owner) caps only tasks with `status: "running"`. Tasks in `status: "waiting"` preserve their branch/PR binding and prevent duplicate dispatch **without** consuming active run capacity.
- **No public metadata noise:** internal fields (`run_id`, `runtime_ref`, `worktree`, `next_trigger`) stay in `.agents/state/`. Public GitHub comments are posted only when explicitly communicating with humans and within `public_comment_mode`.
- **Single-writer discipline:** run one coordinator cycle at a time against `.agents/state/github-queue.json`. If the file is corrupt or shows an unexpected active run whose process status is unclear, reconcile before dispatching new work.
- **No secrets:** never store tokens, credentials, or private security advisory details in state files or public comments.

## Dispatch, handoff, and release

1. **Incremental sync:** fetch a lightweight list of all open issues (`number,title,labels,assignees,updatedAt`) and all open PRs (`number,title,labels,isDraft,headRefOid,baseRefOid,reviewDecision,closingIssuesReferences,updatedAt`), paginating as needed. Fetch full bodies, comments, reviews, review threads, and check rollups only for tracked tasks, items updated since `last_synced_at`, unlabeled items, and dispatch candidates.
2. **Reconcile tracked tasks:** check whether any `running` runtime has finished, whether any `waiting` task received new owner/user activity or a new PR head SHA, and whether any delivered PR merged or closed. Update workflow labels from observed next action.
   - If a tracked PR merged or closed and no further release or verification follow-up remains, the coordinator may close out and delete the entry from `tasks` directly — do not spawn a worker solely to request release.
   - If a waiting task is actionable again (for example, review feedback arrived or a contributor pushed a new PR head), resume the **same task entry** and existing branch/PR with a fresh `run_id`.
3. **Avoid duplicate investigation:** before dispatching an `agent:pending` issue for investigation, verify whether it already has an up-to-date investigation comment against current `main` (such as `<!-- github-maintainer:status -->`) with no new input since. If already investigated and blocked on a decision or prerequisite contract, do not re-investigate; escalate or record the dependency instead.
4. **Select and record before launch:** while `count(status == "running") < max_concurrent_runs`, pick an eligible unclaimed task with no artifact or shared-file conflict. Persist the task entry (`status: "running"`, fresh `run_id`, explicit `mode`, `authorization_ref`, and `public_comment_mode`) to `.agents/state/github-queue.json` before launching the worker.
5. **Launch worker:**
   - **Subagent runner (default locally):** launch a `github-worker` subagent, passing the structured assignment, and record its session/conversation ID in `runtime_ref`: use a strictly read-only/no-shell runner for untrusted external PR static review; allow diagnostic or reproduction commands on trusted `main` for issue investigation (no retained repo edits, commits, or GitHub mutations; use an isolated worktree if creating a temporary repro); use an isolated worktree / shared-repo workspace for authorized implementation.
   - **Manual handoff:** if launching in a separate local session, record `status: "waiting"` until started and output the exact assignment block for the operator.
6. **Reconcile worker handoff:** when the worker finishes or pauses, validate its report against GitHub state, register any newly opened PR under `pull_request` and `related.pull_requests`, update `branch`, `reviewed_head_sha`, `summary`, `next_trigger`, set `status: "waiting"` (or remove on verified completion), and apply the reconciled workflow label.

## Public comments and untrusted PR execution

- **`public_comment_mode`:**
  - `draft_only` (default for external PR reviews and external user replies): worker returns drafted findings or replies to the coordinator for owner review; it does not post publicly under the maintainer's GitHub account.
  - `allowed`: worker may publish clean, human-facing GitHub comments or PR descriptions within the granted scope (never raw internal run state).
- **Untrusted external PR code:** a local worktree or shell that can read `gh` credentials (`~/.config/gh`), `.env`, or host `$HOME` is **not** an isolated environment. Unless an explicitly credential-stripped disposable container/sandbox is used, external PR review workers must perform static review only and clearly disclose unrun tests.

## Key scenarios

| Scenario | Expected behavior |
| --- | --- |
| First run of `/github-coordinator` with no state file | Initialize `.agents/state/github-queue.json` automatically and proceed |
| Two tasks enter `waiting` (e.g. `user:verification`, `owner:review`) | Keep both task bindings in `tasks`; free `running` slots immediately for new work |
| Owner requests changes on a worker's PR | Resume the same `issue#<N>` task and branch with a new `run_id` |
| External contributor pushes a new head on a reviewed PR | Invalidate prior recommendation; resume the same `pr#<N>` task against the new head SHA |
| Worker opens a PR for `issue#<N>` | Worker reports PR number and stops; coordinator registers PR in `issue#<N>` and sets `owner:review` |
| Tracked PR merges with no remaining verification | Coordinator verifies merge/linked issue state and removes the task entry directly |
| `agent:pending` issue already has current-`main` investigation | Do not re-investigate; reconcile label or note blocking decision/dependency |
| External PR review on a machine with `gh` credentials | Static review only unless a credential-free disposable container is explicitly available |
