# API, CLI, and translation changes

## HTTP APIs

For a new or changed HTTP API, trace the path through:

1. `src/routes/`
2. `src/controllers/`
3. Shared types in `src/types/`
4. Tests covering the contract

Inspect neighboring routes and controllers before introducing a new pattern.

## CLI commands

Add a CLI subcommand in `src/cli/commands/<name>.ts`, register it in the dispatcher in `src/cli/main.ts`, document it in `src/cli/help.ts`, and add tests under `tests/cli/commands/`.

## Public documentation

Update the relevant files under `docs/` for public API or behavior changes. Reflect major changes in every applicable `README*.md` variant.
