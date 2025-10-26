# Repository Guidelines

These notes align current contributors around the code layout, daily commands, and collaboration habits that keep `@samanhappy/mcphub` moving quickly.

## Project Structure & Module Organization
- Backend services live in `src`, grouped by responsibility (`controllers/`, `services/`, `dao/`, `routes/`, `utils/`), with `server.ts` orchestrating HTTP bootstrap.
- `frontend/src` contains the Vite + React dashboard; `frontend/public` hosts static assets and translations sit in `locales/`.
- Jest-aware test code is split between colocated specs (`src/**/*.{test,spec}.ts`) and higher-level suites in `tests/`; use `tests/utils/` helpers when exercising the CLI or SSE flows.
- Build artifacts and bundles are generated into `dist/`, `frontend/dist/`, and `coverage/`; never edit these manually.

## Build, Test, and Development Commands
- `pnpm dev` runs backend (`tsx watch src/index.ts`) and frontend (`vite`) together for local iteration.
- `pnpm backend:dev`, `pnpm frontend:dev`, and `pnpm frontend:preview` target each surface independently; prefer them when debugging one stack.
- `pnpm build` executes `pnpm backend:build` (TypeScript to `dist/`) and `pnpm frontend:build`; run before release or publishing.
- `pnpm test`, `pnpm test:watch`, and `pnpm test:coverage` drive Jest; `pnpm lint` and `pnpm format` enforce style via ESLint and Prettier.

## Coding Style & Naming Conventions
- TypeScript everywhere; default to 2-space indentation and single quotes, letting Prettier settle formatting. ESLint configuration assumes ES modules.
- Name services and data access layers with suffixes (`UserService`, `AuthDao`), React components and files in `PascalCase`, and utility modules in `camelCase`.
- Keep DTOs and shared types in `src/types` to avoid duplication; re-export through index files only when it clarifies imports.

## Testing Guidelines
- Use Jest with the `ts-jest` ESM preset; place shared setup in `tests/setup.ts` and mock helpers under `tests/utils/`.
- Mirror production directory names when adding new suites and end filenames with `.test.ts` or `.spec.ts` for automatic discovery.
- Aim to maintain or raise coverage when touching critical flows (auth, OAuth, SSE); add integration tests under `tests/integration/` when touching cross-service logic.

## Commit & Pull Request Guidelines
- Follow the existing Conventional Commit pattern (`feat:`, `fix:`, `chore:`, etc.) with imperative, present-tense summaries and optional multi-line context.
- Each PR should describe the behavior change, list testing performed, and link issues; include before/after screenshots or GIFs for frontend tweaks.
- Re-run `pnpm build` and `pnpm test` before requesting review, and ensure generated artifacts stay out of the diff.
