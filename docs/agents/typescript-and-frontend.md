# TypeScript and frontend conventions

- Use `.js` extensions for relative ESM imports, including in TypeScript files.
- Keep TypeScript strict; narrow types or define shared types instead of using `any` as a workaround.
- Write code comments in English.
- Follow the repository formatter: two-space indentation and single quotes. Use the flat [eslint.config.mjs](../../eslint.config.mjs) ESLint configuration.
- Name services and DAOs with `Service` and `Dao` suffixes.
- Name React components and their files in `PascalCase`; name utility modules in `camelCase`.
- Put shared types in [src/types/](../../src/types/) instead of redefining DTOs locally.
- When adding a translation key, add it to every locale file in `locales/`: `locales/en.json`, `locales/es.json`, `locales/fr.json`, `locales/tr.json`, `locales/vi.json`, and `locales/zh.json`. The backend discovers locales from the directory (see [src/utils/i18n.ts](../../src/utils/i18n.ts)), but the frontend registers each locale explicitly in [frontend/src/i18n.ts](../../frontend/src/i18n.ts) and lists it in [frontend/src/components/ui/LanguageSwitch.tsx](../../frontend/src/components/ui/LanguageSwitch.tsx).
