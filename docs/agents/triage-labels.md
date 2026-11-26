# Triage labels

Use four independent dimensions for open issues: **Type, Area, Priority, Next action**. Labels are a shared queue for maintainers, contributors and agents, not a promise to ship a feature.

## Type (one primary label)

| Label | Meaning |
| --- | --- |
| `bug` | Incorrect behavior or regression |
| `enhancement` | New capability or improvement |
| `documentation` | Documentation work |
| `question` | Usage or support question |
| `refactor` | Technical debt or internal changes |
| `exploration` | Research or feasibility study |

## Area (one primary, optional secondary)

| Label | Scope |
| --- | --- |
| `area:skills` | Skills, built-in prompts/resources, MCP Apps |
| `area:auth` | Identity, OAuth, SSO, permissions, credentials |
| `area:core` | MCP protocol, connections, sessions, server lifecycle |
| `area:governance` | Audit, activity, governance |
| `area:registry` | Catalog, discovery, server metadata |
| `area:search` | Embedding, vector search |
| `area:deployment` | Deployment, Docker, build, supply chain |

## Priority (zero or one; coordinator manages)

| Label | Meaning |
| --- | --- |
| `priority:p0` | Critical security/availability issue; immediate attention |
| `priority:p1` | Important defect or confirmed high-value work |
| `priority:p2` | Normal improvement |
| `priority:p3` | Low priority or long-term work |

Unlabeled priority means undecided, not P2. The coordinator may set and revise ordinary priorities based on evidence and owner direction; workers recommend changes to the coordinator. Respect explicit owner priority decisions. Priority is not implementation authorization. Use the private advisory process for sensitive vulnerabilities.

## Next action (exactly one after triage)

The workflow label answers **who is responsible for the next action, and what is its progress?** It is not the entire task lifecycle. Use a single label from this table on a triaged open issue; replace it when responsibility changes.

| Label | Next action | Color family |
| --- | --- | --- |
| `owner:decision` | Maintainer decision, approval, access or closure needed | Purple |
| `owner:review` | Maintainer review or acceptance of a reviewable deliverable | Purple |
| `agent:pending` | Available for the agent to pick up and investigate, design or implement within authorization | Blue |
| `agent:in-progress` | Agent has claimed the task and is actively working | Blue |
| `user:feedback` | External reporter or contributor must provide information, respond or revise a contribution | Yellow |
| `user:verification` | External user must validate a delivered fix or behavior | Yellow |
| `deferred` | Explicitly postponed; no party needs to act now | Gray |

An open issue without a workflow label is untriaged. Closing an issue uses GitHub's native state. Labels describe the current responsibility, not the author, assignee, or origin of the issue. A linked PR does not automatically imply owner review: a draft under active agent work stays in progress; if changes are requested from an external contributor, use user feedback; when a deliverable is ready for maintainer review, use owner review.

Investigation, design and implementation are internal agent stages, not separate queue labels. Neither `agent:pending` nor `agent:in-progress` grants implementation authorization. Record the maintainer's explicit task or bounded standing approval in the issue, a linked comment or the authoritative task instructions. Without such approval, agents may investigate and propose but must not implement. See [issue tracker](issue-tracker.md) for the implementation gate and [issue coordination](issue-coordination.md) for exclusive claims. Only the coordinator changes workflow labels; workers report proposed handoffs. A waiting label never releases an existing worker claim.

## Maintainer decision gate

Do not use `owner:decision` as a backlog or a generic request to approve an uninvestigated proposal. Default triaged, actionable work to `agent:pending`.

Use `owner:decision` only when all of these hold:

- Necessary investigation is complete enough, including current behavior and related work, with evidence and remaining uncertainty.
- A concrete maintainer-only decision or action (including access, implementation approval, or closure) blocks further useful work.
- Viable options, trade-offs and a recommendation are documented when relevant.
- The issue body or a status comment records the exact requested decision or action.

If any condition is missing, keep the issue in the agent queue unless another party is actually blocking progress. Related issues can share one decision record. Once a decision is made, record it and transfer the issue to the party responsible for the next action.

## Skill compatibility

| Skill role | MCPHub label / action |
| --- | --- |
| `needs-triage` | Leave untriaged or use `agent:pending` |
| `needs-info` | `user:feedback` if an external user must respond; otherwise continue agent work |
| `ready-for-agent` | `agent:pending`; implementation still requires recorded maintainer authorization |
| `ready-for-human` | Retain as a human-only exclusion; use the appropriate owner workflow label for the next action |
| `wontfix` | Retain for rejected work; close only with maintainer authorization |

Preserve unrelated labels (e.g. `help wanted`, `good first issue`, `ready-for-human`). Do not create a second workflow label. Deprecated labels `agent:investigate`, `agent:ready`, `agent:needs-owner`, `agent:waiting-feedback`, and `agent:deferred` must not be applied to new work. When migrating legacy ready issues, first preserve the original explicit implementation approval in a durable issue record; the new pending label alone is not authorization.

## Label maintenance

Run `bash scripts/sync-issue-labels.sh` with an authenticated maintainer `gh` CLI to provision labels and synchronize their colors and descriptions. The script does not edit individual issues or delete old labels; retain old repository labels for historical issues unless the maintainer explicitly chooses to remove them.
