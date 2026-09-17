// ESLint 9 flat config — TypeScript everywhere, React hooks rules in apps/web.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/out/**",
      "**/coverage/**",
      "**/.cache/**",
      "**/.vercel/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/.lighthouseci/**",
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // the engine names every failure instead of swallowing it; a typed catch is idiomatic here
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["apps/web/**/*.tsx", "apps/web/**/*.ts"],
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    rules: { "@typescript-eslint/no-empty-pattern": "off" },
  },
);
