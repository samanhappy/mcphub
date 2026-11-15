Design-only PR for #1056. No code.

Settles the two points from the maintainer's 2026-11-10 reply, plus the follow-up output-lease detail:

1. **No global heuristic path guard in PR 1.** The ADR records why it is deferred and explicitly documents the risk from other local-file/shell stdio servers in the same deployment.
2. **Input vs output parameters** are identified per tool via `fileStaging { enabled, inputParams, outputParams }`: ready refs only in inputs, reserved refs only in outputs, same ref in both rejected, undeclared refs rejected, and output refs finalized in `try/finally`.
3. **Output refs use an exclusive lease acquired atomically before argument rewrite and the upstream call, held through finalization.** If another call holds the lease, the call is rejected before upstream; a finalizer-only CAS is insufficient. The ADR includes the two-concurrent-calls test (exactly one reaches upstream, no double write).

The ADR also records the pinned `@fangjunjie/ssh-mcp-server@1.11.0` profile, resolved-argv validation, per-principal cwd as an admin opt-in, the shared/owner-only split, and the PR1/PR2/PR3 plan.

Full implementation design: https://gist.github.com/SAXEM1997/496514b20db29a7524894df121018de6

No code in this docs PR; PR1 follows after the design is agreed.

### Review-driven hardening (2026-11-11)

An independent security/spec review of this design found and fixed:

- owner-only SSH staging now also uses the validated adapter + per-principal cwd; there is no hub-cwd staging mode; non-SSH owner-only staging is deferred;
- lease lifetime/startup recovery, multi-ref atomic acquisition, read pins, and quota reservation at lease time;
- reserved `mcphub_file_*` fails closed before the policy/principal wrappers; one rewrite/lease/finalize seam in `callToolWithReconnect`;
- random file-mode server UUIDs + a process lock; system-key rejection before any username fallback; resolved-argv validation;
- the real-SSH suite is an acceptance blocker; its CI job placement is a proposal, not a required workflow until you agree.

PR1 is paused for re-review of the owner-only boundary change.

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
