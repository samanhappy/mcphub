# TypeScript and frontend conventions

- Use `.js` extensions for relative ESM imports, including in TypeScript files.
- Keep TypeScript strict; narrow types or define shared types instead of using `any` as a workaround.
- Write code comments in English.
- Follow the repository formatter: two-space indentation and single quotes. Use the flat [eslint.config.mjs](../../eslint.config.mjs) ESLint configuration.
- Name services and DAOs with `Service` and `Dao` suffixes.
- Name React components and their files in `PascalCase`; name utility modules in `camelCase`.
- Put shared types in [src/types/](../../src/types/) instead of redefining DTOs locally.
- When adding a translation key, add it to all four locale files: `locales/en.json`, `locales/fr.json`, `locales/tr.json`, and `locales/zh.json`.
