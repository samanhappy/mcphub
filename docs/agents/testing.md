# Testing

- Tests use Jest with the `ts-jest` ESM preset. Shared setup is in `tests/setup.ts`; reusable helpers are in `tests/utils/`.
- Place suites under `tests/<area>/` mirroring `src/`, or colocate them as `src/**/*.test.ts`. Both locations are collected.
- Name test files `*.test.ts` or `*.spec.ts`.
- Changes to authentication, OAuth, or SSE flows require an integration test under `tests/integration/` or an extension of an existing one. Do not reduce coverage on these paths.
- Do not change tests just to make them pass unless the intended behavior change is the reason for the test change.
