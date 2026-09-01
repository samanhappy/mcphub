# Agent-guide maintenance

Keep the root guide small and use the nearest scoped guide for details.

Update guidance when:

- A referenced path, command, or invariant no longer matches the code.
- The project adopts a durable workflow or convention that future agents need.
- A new architectural invariant emerges whose violation could silently break behavior.

Do not add:

- Step-by-step build logs, command timings, or wait instructions.
- Facts that are trivially discoverable from the referenced source file or directory.
- Per-task narratives or recent-change summaries; record those in commits, pull requests, or task output.

When editing a guide:

1. Put the rule in the smallest guide that owns it.
2. Prefer a link to the source of truth over copying implementation details.
3. Keep one source of truth for each fact.
4. Check links and scan related guides for stale references after moving a rule.

Add a nested `AGENTS.md` only when a subsystem needs rules that do not generalize to the rest of the repository.
