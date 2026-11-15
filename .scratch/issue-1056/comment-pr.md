Opened a small docs-only PR to settle the two points: https://github.com/samanhappy/mcphub/pull/1471

It adds `docs/adr/0006-file-staging.md` (no code) and answers:

1. **Global heuristic path guard:** out of PR1. The ADR explicitly documents the risk from other local-file/shell stdio servers in the same deployment; the shared boundary is the pinned SSH server's per-user `cwd` root.
2. **Input vs output params:** per-tool `fileStaging { enabled, inputParams, outputParams }`; ready refs only in inputs, reserved refs only in outputs, a ref in both/undeclared params is rejected, and output refs are finalized in `try/finally`.

The pinned `@fangjunjie/ssh-mcp-server@1.11.0` profile, resolved-argv validation, per-principal cwd as an admin opt-in, the owner/shared permission split, and the PR1/PR2/PR3 plan are recorded too.

No implementation until the design is agreed.
