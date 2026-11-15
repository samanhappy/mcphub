# Testing

- Tests use Jest with the `ts-jest` ESM preset. Shared setup is in `tests/setup.ts`; reusable helpers are in `tests/utils/`.
- Place suites under `tests/<area>/` mirroring `src/`, or colocate them as `src/**/*.test.ts`. Both locations are collected.
- Name test files `*.test.ts` or `*.spec.ts`.
- Changes to authentication, OAuth, or SSE flows require an integration test under `tests/integration/` or an extension of an existing one. Do not reduce coverage on these paths.
- Do not change tests just to make them pass unless the intended behavior change is the reason for the test change.

## File staging

Run the focused staging suites (hub tools, ledger backends, rewrite/dispatch, paths, adapter, config validation, download endpoint, connection-change and server-id backfill):

```sh
pnpm exec jest \
  src/services/fileStaging \
  src/utils/__tests__/fileStagingConfig.test.ts \
  tests/controllers/fileStagingController.test.ts \
  tests/controllers/serverController-fileStaging.test.ts \
  tests/controllers/stagingConnectionChange.test.ts \
  tests/dao/serverDaoStagingId.test.ts \
  --runInBand
```

Staging round-trips also touch `tests/utils/serverConfigPersistence.test.ts`, `tests/services/templateService.test.ts` and `tests/frontend/serverFormPayload.test.ts` (config validation, template stripping, and dashboard payload preservation).

The real-SSH acceptance harness is `scripts/verify-staging-ssh-boundary.mjs`. It spawns the pinned `@fangjunjie/ssh-mcp-server@1.11.0` with a per-principal cwd and asserts that `upload` and `download` reject local paths outside that root, including the hub ledger, while a file inside the root succeeds.

```sh
STAGING_CHECK_SSH_HOST=127.0.0.1 \
STAGING_CHECK_SSH_PORT=22222 \
STAGING_CHECK_SSH_USER=staging \
STAGING_CHECK_SSH_KEY=/path/to/key \
STAGING_CHECK_ROOT=/tmp/staging-check-root \
node scripts/verify-staging-ssh-boundary.mjs
```

`STAGING_CHECK_SERVER_ENTRY` optionally points at an unpacked `build/index.js` to skip the `npx` fetch. The harness is a manual acceptance check, not part of CI: it needs a disposable SSH host and account, a private key, and the pinned package, none of which CI provides, and its assertions describe one pinned upstream release. Never point it at a production host. Exit code `0` means every check passed; the JSON report on stdout lists each check.

## Disposable PostgreSQL integration tests

`personal-oauth-db.test.ts` and `tool-policy-db.test.ts` require a disposable local PostgreSQL database. They modify and clear their tables; never point them at retained data. Without `MCPHUB_TEST_PG_PORT`, these suites are skipped.

```sh
docker run --detach --rm --name mcphub-test-pg \
  --publish 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data \
  --env POSTGRES_USER=mcphub_test --env POSTGRES_PASSWORD=mcphub_test \
  --env POSTGRES_DB=mcphub_test postgres:17-bookworm
docker port mcphub-test-pg 5432
docker exec mcphub-test-pg pg_isready -U mcphub_test
# Once ready, use the printed host port:
MCPHUB_TEST_PG_PORT=<port> pnpm exec jest tests/integration/personal-oauth-db.test.ts tests/integration/tool-policy-db.test.ts --runInBand
docker stop mcphub-test-pg
```
