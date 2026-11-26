# GitHub issue and PR tracker

Issues, PRDs and pull requests form one GitHub task queue. A task may be an issue or a standalone PR. Prefer the authenticated `gh` CLI; equivalent authorized GitHub connector operations are acceptable when the CLI is unavailable.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments,assignees,closedByPullRequestsReferences`.
- **List issues (lightweight scan)**: `gh issue list --state open --limit 100 --json number,title,labels,assignees,updatedAt`; paginate if necessary, then inspect full `body`/`comments` only for changed, untriaged, or tracked items.
- **List PRs (lightweight scan)**: `gh pr list --state open --limit 100 --json number,title,labels,isDraft,headRefOid,baseRefOid,reviewDecision,closingIssuesReferences,updatedAt`; paginate if necessary.
- **Read a PR**: `gh pr view <number> --json number,title,body,labels,isDraft,headRefOid,baseRefOid,reviewDecision,reviews,statusCheckRollup,closingIssuesReferences`; read all review threads and the diff separately.
- **Label a PR**: `gh pr edit <number> --add-label "..."` / `--remove-label "..."`.
- **Comment on an issue**: `gh issue comment <number> --body "..."`.
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`.
- **Close**: `gh issue close <number> --comment "..."` only when authorized.

Infer the repo from `git remote -v`. Read [triage labels](triage-labels.md) before classifying or claiming issues.

## Triage and handoff

Use [github-coordinator](../../.agents/skills/github-coordinator/SKILL.md) for global queue management and [github-worker](../../.agents/skills/github-worker/SKILL.md) for individual delivery. The [local-first coordination protocol](github-coordination.md) is authoritative for local queue state, task tracking, dispatch, resumption and release.

- Coordinator reads issues, all open PRs, comments, reviews and current evidence, checks duplicates/dependencies, and owns Type/Area/Priority/workflow labels. Preserve unrelated labels and respect explicit owner decisions. Default triaged actionable work, including review-ready external PRs, to `agent:pending`.
- Workers investigate and report evidence, remaining uncertainty, proposed next-action label and concrete next step for their assigned task only. Group related issues at the coordinator level instead of duplicating analysis.
- Use the [maintainer decision gate](triage-labels.md#maintainer-decision-gate) before escalating. Record the specific question, options, trade-offs and recommendation. Request only missing external information. A workflow label tracks the next actor; waiting on owner or user keeps the task's local branch/PR binding without blocking new concurrent runs.
- Avoid repeated comments or label churn. Keep internal scheduling state in local coordinator storage rather than public GitHub comments. Do not close issues or defer work without maintainer authorization.

## Implementation authorization

`agent:pending` is a unified agent queue for investigation, design and implementation. It does not itself authorize changes to product code. A worker may implement only when the maintainer has explicitly approved the task or provided a bounded standing authorization that covers it. Preserve authorization in the issue, linked comment, or authoritative task instructions. Confirm that:

- Problem, scope, non-goals and acceptance criteria are clear.
- Relevant dependencies and architecture, security and compatibility decisions are resolved.
- There is no active overlapping implementation or PR.
- The work can be verified with tests or a documented validation method.

Without sufficient approval, investigate and propose the next step; escalate only when a concrete decision blocks progress. Do not treat a detailed proposal, old queue label or priority as approval. The maintainer may approve multiple bounded tasks at once. The coordinator can prioritize independently, but cannot grant implementation approval beyond the owner's authorization.

## Claim and execute

- Candidate discovery: `gh issue list --state open --label agent:pending --search 'no:assignee -label:ready-for-human' --limit 100` and `gh pr list --state open --label agent:pending --limit 100` (paginate). Exclude drafts awaiting their authors, human-only work, issues already carrying a current-`main` investigation, and already-tracked tasks. Reconcile against `.agents/state/github-queue.json` before dispatch.
- Only the coordinator assigns or resumes a worker, following the [local-first coordination protocol](github-coordination.md#dispatch-handoff-and-release). Workers must not self-claim. Use independent worktrees for concurrent implementations.
- Keep one tracked task (`issue#<N>` or `pr#<N>`) across investigation, implementation, linked PR review, release and user verification. Pause (`waiting`) when blocked; waiting tasks preserve branch/PR context without consuming `max_concurrent_runs`.
- Worker returns structured handoff evidence directly to the coordinator; coordinator updates workflow labels and local state. Reviewable deliverables go to `owner:review`, requested external changes to `user:feedback`, delivered fixes awaiting reporter validation to `user:verification`. Resume the same task record and branch/PR when actionable again.
- For independent PR review, follow the same PR across revisions, record reviewed head/base SHAs and testing evidence, and respect `public_comment_mode` (default `draft_only`). Do not modify a contributor's branch without separate authorization, and do not execute untrusted PR code in a shell with `gh` credentials or host secrets. Do not create a synthetic issue merely to track a PR.
- Review agents report findings and do not merge. Maintainers own merge and closure decisions. Coordinator closes out a task entry once delivery is accepted (or merged with no remaining verification follow-up). Follow the private security advisory lifecycle for sensitive issues.

## Skill integration

When a skill says "publish to the issue tracker", create a GitHub issue if authorized. When a skill says "fetch the relevant ticket", read the issue or PR and its latest comments/reviews. Translate skill triage roles using [triage labels](triage-labels.md); a queue label never grants permission to implement.
