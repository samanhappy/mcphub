# Testing

- Tests use Jest with the `ts-jest` ESM preset. Shared setup is in `tests/setup.ts`; reusable helpers are in `tests/utils/`.
- Place suites under `tests/<area>/` mirroring `src/`, or colocate them as `src/**/*.test.ts`. Both locations are collected.
- Name test files `*.test.ts` or `*.spec.ts`.
- Changes to authentication, OAuth, or SSE flows require an integration test under `tests/integration/` or an extension of an existing one. Do not reduce coverage on these paths.
- Do not change tests just to make them pass unless the intended behavior change is the reason for the test change.

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
