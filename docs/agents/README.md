# Agent Documentation

Start with the root [AGENTS.md](../../AGENTS.md), then read only the guide that matches the area being changed. The current implementation is authoritative when documentation is stale; tests document expected behavior and should change only when behavior intentionally changes.

## Guide map

| Area | Guide |
| --- | --- |
| Runtime, persistence, routing, and authentication | [architecture.md](architecture.md) |
| Commands, local development, and troubleshooting | [development.md](development.md) |
| TypeScript, React, formatting, and naming | [typescript-and-frontend.md](typescript-and-frontend.md) |
| Jest suites and regression coverage | [testing.md](testing.md) |
| HTTP APIs, CLI commands, and translations | [api-and-cli.md](api-and-cli.md) |
| Commits, pull requests, GitHub, and public docs | [git-and-contribution.md](git-and-contribution.md) |
| Keeping agent guidance accurate and small | [guide-maintenance.md](guide-maintenance.md) |
| Domain vocabulary and ADRs | [domain.md](domain.md) |
| Issue operations | [issue-tracker.md](issue-tracker.md) |
| Triage labels | [triage-labels.md](triage-labels.md) |

## Suggested `docs/` structure

```text
docs/
├── agents/              # Agent-only, task-scoped instructions
│   ├── README.md
│   ├── architecture.md
│   ├── development.md
│   ├── typescript-and-frontend.md
│   ├── testing.md
│   ├── api-and-cli.md
│   ├── git-and-contribution.md
│   ├── guide-maintenance.md
│   ├── domain.md
│   ├── issue-tracker.md
│   └── triage-labels.md
├── adr/                 # Accepted architectural decisions
├── development/         # Public developer documentation
├── configuration/       # Public deployment and configuration docs
├── features/            # Public feature documentation
└── zh/                  # Chinese public documentation
```
