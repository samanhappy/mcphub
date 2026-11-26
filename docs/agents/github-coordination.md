# GitHub coordination (local-first)

[github-coordinator](../../.agents/skills/github-coordinator/SKILL.md) manages the whole queue. [github-worker](../../.agents/skills/github-worker/SKILL.md) owns one issue or PR task end to end. Read [triage labels](triage-labels.md) and [issue tracker](issue-tracker.md) for labels and implementation authorization.

## Roles and authority

- **Owner:** product direction, architecture/security decisions, implementation approval (including bounded standing approval), merge, release, and public external communication policy.
- **Coordinator:** triage, Type/Area/Priority/workflow labels, dependency and overlap checks, local queue state, task dispatch/resumption, post-PR automated follow-up within guardrails (at most 1 `gh run rerun --failed` on confirmed unrelated CI flakes; at most 2 auto-fix rounds resuming the owning worker for real CI failures or valid in-scope owner/bot review findings), and concise summaries (default Chinese `report_language: "zh"`). May set or revise ordinary priorities without per-issue approval, respecting explicit owner decisions. Does not implement product changes or perform deep per-task investigation.
- **Worker:** investigate, design, implement when authorized (including `standing_approval:low_risk_fix` within its boundaries), test, open and follow up its PR, review external PRs, and return a thin handoff plus persisted detail notes. Does not claim new work, edit the local queue state, set priority or workflow labels, approve out-of-scope implementation, or merge PRs.

Workflow labels identify **who acts next**, not task ownership. A tracked task retains its local binding (branch, PR, worktree, history) while waiting on owner decisions, PR review, contributor revisions, release, or verification.

## Task identity and linked artifacts

Every tracked task is keyed by its primary artifact: `issue#<N>` or `pr#<N>`. Confirm artifact type from the GitHub API since issues and PRs share a number namespace.

- An issue with a worker-created PR stays one task (`issue#<N>`). Record the PR under `related.pull_requests` and `pull_request`; never dispatch it as independent review work.
- A standalone external PR is a `pr#<N>` review task (no synthetic issue required). If it addresses an unclaimed issue, record that issue in `related.issues` under the same task. If the issue is already tracked, reconcile overlap before dispatching anything new.
- Competing PRs addressing the same issue belong to one conflict group under a single task for evaluation; never dispatch rival implementations.
- **Exclusive vs non-exclusive links:** `related` (`issues` / `pull_requests`) is an **exclusive reservation** owned by one task. Incidental references and background context belong in optional non-exclusive `references` (never in `related`) so unrelated issues are not reserved.
- Label each triaged issue and PR from its actual next action. Related artifacts can hold different labels (for example, a merged PR and an issue awaiting release verification). Labels never override local task tracking.

## Local state store

Coordinator state lives locally in `<primary-repo>/.agents/state/github-queue.json` (gitignored, private, never committed, and never posted to public GitHub comments). Detailed per-task handoff notes live in `<primary-repo>/.agents/state/tasks/<task-key>.md`. Because `.agents/state/` is gitignored, it exists only in the **primary repository checkout** and is **not** copied into `share` worktrees — always pass absolute paths to workers.

If `.agents/state/github-queue.json` does not exist on the first run, the coordinator initializes it automatically:

```json
{
  "version": 1,
  "repository": "samanhappy/mcphub",
  "report_language": "zh",
  "max_concurrent_runs": 2,
  "last_synced_at": "2026-11-26T01:30:00Z",
  "tasks": {
    "issue#1526": {
      "task": {"type": "issue", "number": 1526},
      "related": {"issues": [], "pull_requests": [1600]},
      "references": [],
      "mode": "implementation",
      "status": "waiting",
      "authorization_ref": "owner chat approval 2026-11-26",
      "public_comment_mode": "draft_only",
      "pr_link_mode": "closes",
      "run_id": "20261126-01",
      "runtime_ref": null,
      "branch": "feat/1526-bearer-key-expiry",
      "worktree": null,
      "pull_request": 1600,
      "head_sha": "abc1234",
      "reviewed_head_sha": null,
      "updated_at": "2026-11-26T01:30:00Z",
      "summary": "PR #1600 opened with expiry + isolated last_used writes",
      "next_trigger": "owner:review on PR #1600"
    }
  }
}
```

### State invariants

- **Task-keyed exclusivity:** each primary artifact and every number in `related.issues` / `related.pull_requests` belongs to at most one entry in `tasks`. Non-exclusive context belongs in `references`.
- **SHA fields:** use `head_sha` for the latest pushed commit on a worker-owned implementation PR, and `reviewed_head_sha` for the latest reviewed head commit on an external PR.
- **Concurrency without starvation:** `max_concurrent_runs` (default `2`, configurable up to e.g. `3` on high-resource hosts) caps only tasks with `status: "running"`. Keeping heavy implementation runs capped prevents local CPU/memory/port contention during `pnpm test:ci` / `pnpm build` and reduces shared-file collisions. Tasks in `status: "waiting"` preserve their branch/PR/worktree binding **without** consuming active run capacity.
- **No public metadata noise:** internal fields (`run_id`, `runtime_ref`, `worktree`, `next_trigger`) stay in `.agents/state/`. Public GitHub comments are posted only when explicitly communicating with humans and within `public_comment_mode`.
- **Single-writer discipline:** run one coordinator cycle at a time against `.agents/state/github-queue.json`. If the file is corrupt or shows an unexpected active run whose process status is unclear, reconcile before dispatching new work.
- **No secrets:** never store tokens, credentials, or private security advisory details in state files or public comments.

## Dispatch, handoff, and release

1. **Incremental sync:** fetch a lightweight list of all open issues (`number,title,labels,assignees,updatedAt`) and all open PRs (`number,title,labels,isDraft,headRefOid,baseRefOid,reviewDecision,closingIssuesReferences,updatedAt`), paginating as needed. Fetch full bodies, comments, reviews, review threads, and check rollups only for tracked tasks, items updated since `last_synced_at`, unlabeled items, and dispatch candidates.
   - **Staleness check:** measure `user:feedback` / `user:verification` quiet time (>14 days) from the **latest comment or review timestamp**, not `issue.updatedAt` (which bulk label edits bump).
   - **Public vs private security issues:** private reports follow [security-advisories.md](security-advisories.md). Publicly filed high/critical security issues are verified on `main` first (provisional `priority:p1` until confirmed → `priority:p0`), fixed through the normal PR flow, and flagged for `owner:decision` on whether to publish a post-fix GHSA/CVE.
2. **Reconcile tracked tasks:** check whether any `running` runtime has finished, whether any `waiting` task received new owner/user activity or a new PR head SHA, and whether any delivered PR merged or closed. Update workflow labels from observed next action, verifying each `gh` write succeeded (do one idempotent retry on transient TLS/EOF failures).
   - If a tracked PR merged or closed and no further release or verification follow-up remains, the coordinator closes out the task, cleans up any local worktree/subagent no longer needed, and deletes the entry from `tasks` directly — do not spawn a worker solely to request release.
   - If a waiting task is actionable again (for example, review feedback arrived or a contributor pushed a new PR head), resume the **same task entry** and existing subagent/branch/PR with a fresh `run_id`.
   - **Automated PR CI & bot-review follow-up (with anti-loop guardrails):**
     - **Confirmed unrelated CI flake** (e.g., runner timing jitter): coordinator triggers `gh run rerun --failed` at most **once** and reports both the failure and rerun; escalate to `owner:decision` if the rerun still fails.
     - **Real CI failure or valid in-scope review finding** (from owner or automated review bots such as Codex/Copilot): coordinator resumes the owning worker subagent via `send_message` on the same branch/worktree (capped at **2 automated fix rounds** per PR to prevent loops). Workers evaluate bot findings critically — fixing valid defects with regression tests, and declining false positives or scope-changing requests with rationale for owner review.
3. **Avoid duplicate investigation:** before dispatching an `agent:pending` issue for investigation, verify whether it already has an up-to-date investigation comment against current `main` (such as `<!-- github-maintainer:status -->`) with no new input since. If already investigated and blocked on a decision or prerequisite contract, do not re-investigate; escalate or record the dependency instead.
4. **Select and record before launch:** while `count(status == "running") < max_concurrent_runs`, pick an eligible unclaimed task with no artifact or shared-file conflict. Persist the task entry (`status: "running"`, fresh `run_id`, explicit `mode`, `authorization_ref`, `public_comment_mode`, and `pr_link_mode` for implementation) to `.agents/state/github-queue.json` before launching the worker.
5. **Launch or resume worker:**
   - **Issue investigation & implementation (`Workspace: "share"`):** launch issue investigation workers in an isolated shared-repo worktree (`Workspace: "share"`, no retained edits/commits). When implementation is approved in the same session, **resume that same subagent via `send_message`** in its existing worktree to inherit full codebase context without re-reading. Fall back to a fresh `share` worktree worker reading the absolute `<primary-repo>/.agents/state/tasks/<task-key>.md` path across sessions or if the prior subagent is gone.
   - **Untrusted external PR static review:** strictly read-only / no-shell runner; never reused for implementation.
   - **Manual handoff:** if launching in a separate local session, record `status: "waiting"` until started and output the exact assignment block for the operator.
6. **Reconcile worker handoff (thin reply + detail file):** workers write full findings, option comparisons, file lists, and `draft_only` replies to `<primary-repo>/.agents/state/tasks/<task-key>.md` and return a ≤15-line summary directly to the coordinator to prevent context bloat. Validate the report against GitHub state, register any newly opened PR under `pull_request` and `related.pull_requests`, update `branch`, `head_sha` / `reviewed_head_sha`, `summary`, `next_trigger`, set `status: "waiting"` (retaining the worktree during `owner:review` for fast follow-up, or cleaning up on closeout), and apply the reconciled workflow label.

## Public comments and untrusted PR execution

- **`public_comment_mode`:**
  - `draft_only` (default for external PR reviews, investigations, and external user replies): worker saves drafted replies in the detail file instead of posting issue/review comments under the maintainer's GitHub account. In `implementation` mode, `authorization_ref` still authorizes creating/updating the PR description (`gh pr create`).
  - `allowed`: worker may publish clean, human-facing GitHub comments or PR descriptions within the granted scope (never raw internal run state).
- **Untrusted external PR code:** a local worktree or shell that can read `gh` credentials (`~/.config/gh`), `.env`, or host `$HOME` is **not** an isolated environment. Unless an explicitly credential-stripped disposable container/sandbox is used, external PR review workers must perform static review only and clearly disclose unrun tests.

## Scaling beyond a single host

`.agents/state/github-queue.json` is intentionally designed for single-host, single-coordinator operation. Pure GitHub labels/comments cannot safely replace it for multi-host concurrency because the GitHub Labels API lacks atomic compare-and-swap (CAS) locks, internal scheduling state pollutes public issues and risks leaking draft assessments, and API rate limits/transient errors make GitHub fragile as a lock database.

If multi-host or multi-agent concurrency is needed later, evolve in stages rather than overloading public labels:

1. **Stage 1 (current — single host):** local `github-queue.json` + GitHub labels as public workflow view.
2. **Stage 2 (lightweight multi-host, zero extra servers):** keep GitHub labels/PRs as the public view, use atomic Git remote branch creation (e.g. `git push origin HEAD:refs/heads/agent-claim/issue-<N>`) or GitHub Actions `concurrency` groups for distributed mutual exclusion, and store internal state/notes in a separate private repository or private state branch.
3. **Stage 3 (multi-host fleet):** use a dedicated queue/database (`SELECT ... FOR UPDATE SKIP LOCKED` or Redis) with GitHub acting strictly as the event source and delivery surface.

## Key scenarios

| Scenario | Expected behavior |
| --- | --- |
| First run of `/github-coordinator` with no state file | Initialize `.agents/state/github-queue.json` automatically (`report_language: "zh"`) and proceed |
| Low-risk, unambiguous bug/doc/test issue | Dispatch under `standing_approval:low_risk_fix` for direct PR (`owner:review`); stop for `owner:decision` if any exclusion applies |
| Investigation approved for implementation in same session | Resume the same `share`-worktree subagent via `send_message` to inherit codebase context |
| Two tasks enter `waiting` (e.g. `user:verification`, `owner:review`) | Keep both task bindings in `tasks`; free `running` slots immediately for new work |
| Owner requests changes on a worker's PR | Resume the same `issue#<N>` task and worktree/branch with a new `run_id` |
| External contributor pushes a new head on a reviewed PR | Invalidate prior recommendation; resume the same `pr#<N>` task against the new head SHA |
| Worker opens a PR for `issue#<N>` | Worker saves details to `.agents/state/tasks/issue-<N>.md`, returns ≤15-line summary; coordinator registers PR and sets `owner:review` |
| Worker PR fails CI on confirmed unrelated flake | Coordinator runs `gh run rerun --failed` once and reports both failure and rerun |
| Tracked PR merges with no remaining verification | Coordinator verifies merge/linked issue state, cleans up worktree, and removes task entry directly |
| `agent:pending` issue already has current-`main` investigation | Do not re-investigate; reconcile label or note blocking decision/dependency |
| External PR review on a machine with `gh` credentials | Static review only unless a credential-free disposable container is explicitly available |
