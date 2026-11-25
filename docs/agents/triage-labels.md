# Triage labels

Use four independent dimensions for open issues: **Type, Area, Priority, Agent**. Labels are a shared queue for maintainers, contributors and agents, not a promise to ship a feature.

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

## Priority (zero or one; maintainer decides)

| Label | Meaning |
| --- | --- |
| `priority:p0` | Critical security/availability issue; immediate attention |
| `priority:p1` | Important defect or confirmed high-value work |
| `priority:p2` | Normal improvement |
| `priority:p3` | Low priority or long-term work |

Unlabeled priority means undecided, not P2. Agents may recommend priority but must not set or change it without maintainer approval. Use the private advisory process for sensitive vulnerabilities.

## Agent state (zero or one)

| Label | Next action |
| --- | --- |
| `agent:investigate` | Investigate, reproduce, inspect code and propose options; no implementation |
| `agent:needs-owner` | Maintainer must make a product, scope or architecture decision |
| `agent:waiting-feedback` | Wait for reporter/user information or validation |
| `agent:ready` | Maintainer approved a bounded, testable implementation |
| `agent:in-progress` | Claimed by a contributor or agent, or implementation PR exists |
| `agent:deferred` | Intentionally postponed by a maintainer |

No agent state means untriaged. Only `agent:ready` authorizes autonomous implementation; explicit maintainer instructions can also authorize a specific task. A detailed proposal, priority label, or community reaction alone is not approval. See [issue tracker](issue-tracker.md) for operational rules.

## Skill compatibility

When a skill uses canonical roles from mattpocock/skills, translate as follows:

| Skill role | MCPHub label / action |
| --- | --- |
| `needs-triage` | `agent:needs-owner` if maintainer evaluation is needed; otherwise `agent:investigate` or leave untriaged |
| `needs-info` | `agent:waiting-feedback` |
| `ready-for-agent` | `agent:ready` only after explicit maintainer approval |
| `ready-for-human` | Retain `ready-for-human` as a human-only exclusion; do not add `agent:ready` |
| `wontfix` | Retain for rejected work; close only with maintainer authorization |

Legacy labels do not by themselves grant implementation permission. Preserve unrelated community labels (e.g. `help wanted`, `good first issue`). Do not introduce a second workflow state under a different prefix. Use GitHub PRs for review and closed issues for completion, not additional agent states.

## Label maintenance

Repository maintainers can run `bash scripts/sync-issue-labels.sh` from a clone with an authenticated `gh` CLI. It creates missing labels and synchronizes custom label descriptions and colors. It does not change any issue assignments or labels on individual issues and does not delete legacy labels.
