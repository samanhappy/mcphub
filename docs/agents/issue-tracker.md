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

## Triage

1. Read the issue, latest comments, related issues, linked PRs and current code as needed. Look for already shipped fixes, duplicates and overlapping work.
2. Apply one Type and at least one Area when identifiable. Preserve unrelated labels.
3. Default triaged, unapproved work to `agent:investigate`. Check whether the next action is actually user feedback, existing implementation, or an explicit deferral. Recommend a priority when supported; only set it with maintainer approval.
4. For an investigation, report evidence (version/commit, paths, reproduction, test results), remaining uncertainty, and a concrete recommended next step. Group related issues when they share a design or dependency; do not escalate each proposal independently before analysis. Ask for only the missing user information.
5. Escalate to `agent:needs-owner` only after the [maintainer decision gate](triage-labels.md#maintainer-decision-gate) passes. Record the exact blocking decision, evidence, viable options, trade-offs and recommendation in the issue or a status comment before changing its state. If further useful analysis is possible, continue investigation rather than escalating. If an existing owner-state issue lacks an actionable decision record, return it to investigation.
6. Avoid repeated comments or label churn; update an existing agent-authored status comment when practical. Do not change issue scope or close an issue without authorization.

## Ready gate

Only maintainers may approve `agent:ready`. Before approval, confirm:

- Problem, scope, non-goals and acceptance criteria are clear.
- Relevant dependencies and architecture, security and protocol compatibility decisions are resolved.
- There is no active implementation or overlapping open PR.
- The task can be verified with tests or a documented validation method.

## Claim and implement

- Candidate queue: `gh issue list --state open --label agent:ready --search 'no:assignee -label:ready-for-human' --limit 100`.
- Prioritize approved P0/P1, then P2/P3; unknown priority is not P2. Do not start untriaged, deferred, human-only or conflicting-state issues.
- Re-read the issue, assignees, linked/open PRs and claims immediately before starting. Use a single maintainer/dispatcher to grant exclusive claims for concurrent agents. GitHub label updates alone are not an atomic lock. If no dispatcher is available, do not run parallel autonomous claimers.
- Record the claimant and branch/worktree in a claim comment or assignment, replace the prior agent label with `agent:in-progress`, and re-read to confirm the claim before coding. Stop if another claim or implementation is discovered.
- Work within the approved scope, follow repository guides, run relevant tests and open a linked PR. Report test evidence, known limitations and any scope deviations. Keep the issue in progress while its PR is active.
- If blocked, record the blocker and release the claim into the appropriate waiting/investigation state. Return to ready only if approval still applies and no active PR/claim remains.
- Review agents report findings and do not merge. Maintainers own merge and closure decisions; use the linked PR's closing reference where appropriate. Follow the private security advisory lifecycle for sensitive issues.

## Skill integration

When a skill says "publish to the issue tracker", create a GitHub issue. When a skill says "fetch the relevant ticket", read the issue and its latest comments. Translate skill triage roles using [triage labels](triage-labels.md); legacy labels are not permission to implement.
