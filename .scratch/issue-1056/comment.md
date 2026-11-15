Thanks for the direction — I've written the fuller Phase 1 design for (b): [full design](https://gist.github.com/SAXEM1997/496514b20db29a7524894df121018de6).

**Short version**

Scope: PR1 is backend/API only; PR2 adds browser upload + UI; `$smart` is deferred to PR3 as you suggested. PR1 covers owner-only staging and shared staging through an explicitly trusted `ssh` server.

Trust model for shared staging:
- A per-server, admin-only `staging { shared: true, adapter: 'ssh' }` declaration. `credentialTemplate` and a per-user cwd alone never enable shared staging.
- The adapter is validated against a pinned profile: `@fangjunjie/ssh-mcp-server@1.11.0`, args pinned, no `--allowed-local-paths` and no `--config-file`, per-principal child cwd = the per-user staging root, runtime `serverInfo.version === 1.11.0`.
- Credential args are checked on the **resolved** argv with a strict option allowlist, so an args slot cannot inject `--allowed-local-paths=/` or `--config-file`.
- The hub also rejects raw paths to the entire staging base, other principals' roots, MCPB, settings/state/DB, and `.env` in any stdio call; refs are owner/server-bound.
- If the pinned version or flags cannot be verified, shared staging stays disabled. Owner-only staging remains available.

Flow and storage:
- `upload` creates a registered ref (small inline file, or an empty output destination); `status`; `download` returns a short-lived, one-time URL only for a ready registered ref.
- Exact `mcpfile://<uuid>` rewrite only; no response scanning and no automatic path detection.
- Per-principal hash directories + UUIDs; authoritative hub ledger; per-ref lease/CAS; TTL/quota; metadata-only activity logging.

Tests: §11 of the design has the negative matrix — cross-user/other-root/MCPB/settings, credential-slot injection, symlinked parents/hardlinks, foreign refs, version mismatch, owner/public/shared-user cases — run against the pinned ssh server in a disposable instance. These are acceptance blockers before implementation.

**Open questions**

1. Does the pinned `1.11.0` profile + resolved-argv validation meet your "trusted server configuration" bar? If a deployment uses another version, extra `--allowed-local-paths`, or a config file, shared staging will be disabled rather than guessed.
2. Shared staging changes the child cwd for every tool on that server (relative paths resolve under the per-user root). That is the mechanism that makes the server's own root check meaningful, but it is a behavior change. Is that acceptable as an admin opt-in, or would you prefer a narrower tool-level opt-in?
3. For the per-tool `fileStaging` flag, I currently follow the existing tool-settings permission (owner/admin), while `staging.shared` is admin-only. Would you rather make both admin-only?

No code yet. After your feedback the next step is PR1 (backend/API), then PR2. Happy to move the design to a docs PR/ADR if that is easier to review.
