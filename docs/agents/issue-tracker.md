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

`agent:pending` is a unified agent queue for investigation, design and implementation. It does not itself authorize changes to product code. A worker may implement only when the maintainer has explicitly approved the task or the task is covered by the bounded standing approval below. Preserve authorization in the issue, linked comment, or authoritative task instructions. Confirm that:

- Problem, scope, non-goals and acceptance criteria are clear.
- Relevant dependencies and architecture, security and compatibility decisions are resolved.
- There is no active overlapping implementation or PR.
- The work can be verified with tests or a documented validation method.

### Bounded standing approval (`standing_approval:bounded_pr`)

The coordinator may dispatch a worker directly into `implementation` to work on an isolated branch and open a reviewable PR straight to `owner:review` — combining pre-implementation and PR review into a single review (never to merge, release, or push to `main`) — under `authorization_ref: "standing_approval:bounded_pr"` (superseding the legacy `standing_approval:low_risk_fix` alias) **only** when **all** of the following hold:

- **Clear priority and converged design:** priority is established (`priority:p0`, `priority:p1`, `priority:p2`, or a confirmed bug) and investigation converged on a single clear design with no mutually-exclusive product or architecture fork.
- **Backward-compatible, additive, and reversible:** existing default behavior is preserved (new behavior is opt-in or strictly additive). This explicitly allows isolated bug fixes, docs/tests, internal refactors, additive backward-compatible DB columns/tables, and additive/opt-in APIs or dashboard UI (with full tests and English UI screenshots).
- **Hard exclusions (must still stop for `owner:decision`):**
  1. **Security, authentication, or authorization boundary changes** (e.g., relaxing access control, changing session/token trust models, or changing release CI privileges/attestation permissions).
  2. **Breaking or irreversible compatibility or data changes.**
  3. **Genuine mutually-exclusive product or architecture forks** where guessing risks wasted implementation.
  4. **External or maintainer boundaries** (issues claimed by an external contributor, cross-repo changes, external IdP/access requirements, releases, or closing/rejecting external requests).

**`owner:review` WIP cap:** to protect maintainer review bandwidth, the coordinator pauses new `standing_approval:bounded_pr` implementation dispatches whenever **3** open agent-authored PRs are already waiting in `owner:review` (explicit owner-approved tasks and follow-ups on existing PRs are unaffected).

If a worker dispatched under `standing_approval:bounded_pr` discovers during investigation that any exclusion or ambiguity applies, it must stop before editing product code and hand off for `owner:decision`.

Without sufficient approval, investigate and propose the next step; escalate only when a concrete decision blocks progress. Do not treat a detailed proposal, old queue label or priority as approval. The maintainer may approve multiple bounded tasks at once. The coordinator can prioritize independently, but cannot grant implementation approval beyond owner authorization and the standing boundary above.

When dispatching implementation, the coordinator passes `pr_link_mode`: `closes` (`Fixes #<N>`) for internal, feature, or security fixes ready to close on merge, or `refs` (`Refs #<N>`) when post-release external `user:verification` is required before closure.

## Claim and execute

- Candidate discovery and resumption follow the [coordination protocol](github-coordination.md#dispatch-handoff-and-release), which evaluates the next step against existing evidence and queue reservations.
- Only the coordinator assigns or resumes a worker, following the [local-first coordination protocol](github-coordination.md#dispatch-handoff-and-release). Workers must not self-claim. Use independent worktrees for concurrent implementations.
- Keep one tracked task (`issue#<N>` or `pr#<N>`) across investigation, implementation, linked PR review, release and user verification. Pause (`waiting`) when blocked; waiting tasks preserve branch/PR context without consuming `max_concurrent_runs`.
- Worker returns structured handoff evidence directly to the coordinator; coordinator updates workflow labels and local state. Reviewable deliverables go to `owner:review`, requested external changes to `user:feedback`, delivered fixes awaiting reporter validation to `user:verification`. Resume the same task record and branch/PR when actionable again.
- For independent PR review, follow the same PR across revisions, record reviewed head/base SHAs and testing evidence, and respect `public_comment_mode` (default `draft_only`). Do not modify a contributor's branch without separate authorization, and do not execute untrusted PR code in a shell with `gh` credentials or host secrets. Do not create a synthetic issue merely to track a PR.
- Review agents report findings and do not merge. Maintainers own merge and closure decisions. Coordinator closes out a task entry once delivery is accepted (or merged with no remaining verification follow-up). Follow the private security advisory lifecycle for sensitive issues.

## Skill integration

When a skill says "publish to the issue tracker", create a GitHub issue if authorized. When a skill says "fetch the relevant ticket", read the issue or PR and its latest comments/reviews. Translate skill triage roles using [triage labels](triage-labels.md); a queue label never grants permission to implement.
