# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Prefer the authenticated `gh` CLI; equivalent authorized GitHub connector operations are acceptable when the CLI is unavailable.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments,assignees,closedByPullRequestsReferences`.
- **List issues**: `gh issue list --state open --limit 100 --json number,title,body,labels,comments,assignees`; paginate if necessary.
- **Comment on an issue**: `gh issue comment <number> --body "..."`.
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`.
- **Close**: `gh issue close <number> --comment "..."` only when authorized.

Infer the repo from `git remote -v`. Read [triage labels](triage-labels.md) before classifying or claiming issues.

## Triage and handoff

1. Read the issue, latest comments, related issues, linked PRs and current code as needed. Look for shipped fixes, duplicates and overlapping work.
2. Apply one Type and at least one Area when identifiable. Preserve unrelated labels. Recommend priority when supported; only set or change it with maintainer approval.
3. Default triaged actionable work to `agent:pending`. Use the [workflow labels](triage-labels.md#next-action-exactly-one-after-triage) to identify the party responsible for the next action. Replace the previous workflow label, preserving Type, Area and Priority.
4. Claim agent work before investigation or implementation. Record evidence (version/commit, paths, reproduction, tests), remaining uncertainty and a concrete next step. Group related issues when they share design or dependencies.
5. Escalate to `owner:decision` only after the [maintainer decision gate](triage-labels.md#maintainer-decision-gate) passes. Record the specific question, options, trade-offs and recommendation before changing the label. Use `user:feedback` only when an external party must respond or revise a contribution; ask for the missing information or changes. Use `user:verification` after a fix is available when external validation is needed. Use `owner:review` when a deliverable is ready for maintainer review.
6. After each handoff, record the next action and replace the workflow label. Avoid repeated comments or label churn; update an existing agent-authored status comment when practical. Do not close issues or defer work without maintainer authorization.

## Implementation authorization

`agent:pending` is a unified agent queue for investigation, design and implementation. It does not itself authorize changes to product code. An agent may implement only when the maintainer has explicitly approved the task or provided a bounded standing authorization that covers it. Preserve authorization in the issue, linked comment, or authoritative task instructions. Confirm that:

- Problem, scope, non-goals and acceptance criteria are clear.
- Relevant dependencies and architecture, security and compatibility decisions are resolved.
- There is no active implementation or overlapping open PR.
- The work can be verified with tests or a documented validation method.

Without sufficient approval, investigate and propose the next step; escalate only when a concrete decision blocks progress. Do not treat a detailed proposal, old queue label or priority as approval. The maintainer may approve multiple bounded tasks at once and return them to `agent:pending`.

## Claim and execute

- Candidate queue: `gh issue list --state open --label agent:pending --search 'no:assignee -label:ready-for-human' --limit 100`.
- Prioritize P0/P1, then P2/P3; unknown priority is not P2. Do not claim deferred, human-only, conflicting-state, already claimed or untriaged issues without explicit instructions.
- Re-read the issue, assignees, linked/open PRs and claims immediately before starting. Use a single maintainer/dispatcher to grant exclusive claims for concurrent agents. GitHub label updates alone are not an atomic lock. If no dispatcher is available, do not run parallel autonomous claimers.
- Record the claimant and task scope (investigation or authorized implementation; include branch/worktree when applicable) in a claim comment or assignment. Replace the pending label with `agent:in-progress` and re-read to confirm the claim before work. Stop if another claim or implementation is discovered.
- Investigate autonomously; implement only within the authorized scope. Follow repository guides, run relevant tests and open a linked PR when implementing. Report test evidence, known limitations and scope deviations.
- Release the claim at handoff. If further agent work is available but no agent is actively working, use `agent:pending`. If a maintainer decision blocks progress, use `owner:decision`; if a PR or other deliverable is ready for maintainer review, use `owner:review`. If an external contributor must revise a PR, use `user:feedback`. Do not leave issues in progress simply because a PR exists.
- Review agents report findings and do not merge. Maintainers own merge and closure decisions. After delivery, use `user:verification` when external verification is needed; otherwise close only when authorized or through an authorized PR's closing reference. Follow the private security advisory lifecycle for sensitive issues.

## Skill integration

When a skill says "publish to the issue tracker", create a GitHub issue. When a skill says "fetch the relevant ticket", read the issue and its latest comments. Translate skill triage roles using [triage labels](triage-labels.md); a queue label never grants permission to implement.
