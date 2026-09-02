# Fix CodeQL `js/clear-text-logging` alerts in `mcpService.ts`

## Problem

39 open `js/clear-text-logging` alerts on `src/services/mcpService.ts` (GH code-scanning, baseline = `main` @ `45e2bd3`). Every flagged `console.*` logs `serverInfo.name` (or a `serverName`/`name` derived from it). The server name is not actually secret — CodeQL flags it because of **whole-object taint tracking**: the `ServerInfo` object carries `oauth.codeVerifier` (a PKCE credential), so every field read off `serverInfo` (including `.name`) is treated as sensitive.

PR #1032 / commit `3290089` fixed this for the on-demand-wake region by reading the name from the DAO (`rawConfig.name`) instead of `serverInfo.name`. The DAO crosses a `JSON.parse` boundary (`JsonFileBaseDao.loadSettings`), so its return value is not tainted.

## Root cause

`ServerInfo.oauth.codeVerifier` is **write-only dead data**:

- Written in two places: `mcpService.ts:1778` (from `pendingAuth.codeVerifier`) and `mcpOAuthProvider.ts:357` (from `this._codeVerifier`).
- Read **nowhere**:
  - The frontend serializer (`mcpService.ts:2045-2058`) explicitly strips it — comment: *"Don't expose codeVerifier to frontend for security"*.
  - The OAuth provider's `codeVerifier()` getter (`mcpOAuthProvider.ts:405-415`) reads from its own `_codeVerifier` or the DAO's `pendingAuthorization.codeVerifier` — never from `serverInfo.oauth.codeVerifier`.
  - `oauthCallbackController.ts:345` only clears it.
- It exists solely as the taint source. The other `oauth` fields (`authorizationUrl`, `state`, `connected`, `clientIdConfigured`) are non-secret (and `state`/`authorizationUrl` are already exposed to the frontend), so removing `codeVerifier` alone neutralises the source — consistent with `3290089`'s diagnosis.

The 9 tool/prompt-handler alerts additionally list `oauthServer`/`oauthClients`/`oauthTokens` (in `config/index.ts`, `dataService.ts`) as sources. Those flow through `filterSettings`/`filterData`, which is only called on the **API listing path** (`mcpService.ts:1989, 3966`) — never on the tool/prompt path, which uses `getServerByName` → `serverInfos.find()`. `serverInfos` is built from `getServerDao().findAll()` (`mcpService.ts:1527`, JSON boundary). So that secondary taint is CodeQL global-tracking imprecision; it should collapse once the primary source is gone.

## Fix (root-cause, not per-site)

Remove the dead `codeVerifier` from `ServerInfo.oauth`. This is the root-cause realisation of the `3290089` pattern — clearing the taint at its source instead of working around it at 39 log sites (many of which are sync utilities or hot tool-call logs where an async DAO lookup per log is impractical).

### Source changes

1. `src/services/mcpService.ts:1778` — remove `codeVerifier: pendingAuth.codeVerifier,` from the `serverInfo.oauth = { … }` assignment.
2. `src/services/mcpOAuthProvider.ts:357` — remove `codeVerifier: this._codeVerifier,` from the `serverInfo.oauth = { … }` assignment.
3. `src/controllers/oauthCallbackController.ts:345` — remove `serverInfo.oauth.codeVerifier = undefined;` (field is never set now).
4. `src/types/index.ts:545` — remove `codeVerifier?: string;` from `ServerInfo['oauth']`. **Keep** `types/index.ts:463` (`pendingAuthorization.codeVerifier`) — that is the DAO-stored value the OAuth provider reads.

### Test changes (`tests/services/mcpService-toggle.test.ts`)

- L210, L369: remove `codeVerifier` from `serverInfo.oauth` fixtures.
- L241: remove `codeVerifier` from the expected `oauth` in `toMatchObject`.
- L244: remove `expect(getServerByName('notion')?.oauth?.codeVerifier).toBe('verifier-1')`.
- **Keep** L224 (`pendingAuthorization.codeVerifier`).

`tests/utils/serialization.test.ts` (redaction of the literal key `codeVerifier` by `safeStringify`) is unrelated — untouched.

## Behaviour impact

None. `serverInfo.oauth.codeVerifier` was never read. `pendingAuthorization.codeVerifier` (DAO) and the OAuth provider's `_codeVerifier` are untouched, so PKCE still works.

## Verification

- `pnpm lint && pnpm test:ci && pnpm build` (AGENTS.md pre-commit gate).
- Push so CodeQL re-scans; confirm the 39 alerts close (the on-demand-wake alerts `3290089` targeted are already resolved on this branch).
