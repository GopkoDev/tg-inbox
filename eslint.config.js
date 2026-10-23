import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/*.gen.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts', '*.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // The notifications service worker is a plain script served from the web app's root.
    files: ['apps/web/public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: globals.serviceworker },
  },
  {
    // Playwright flows run in Node (global setup, seeding) next to the browser specs.
    files: ['apps/web/e2e/**/*.ts', 'apps/web/playwright.config.ts'],
    languageOptions: { globals: globals.node },
    // Playwright fixtures call `use(...)`, which is not a React hook.
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
  {
    // Migrations are frozen in time and take Kysely<any> by design.
    files: ['apps/api/migrations/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  prettier,
);
