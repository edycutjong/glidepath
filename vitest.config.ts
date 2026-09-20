import { defineConfig } from "vitest/config";
const root = new URL("./", import.meta.url).pathname;
export default defineConfig({
  // guard.test.ts renders the /api/og route (TSX) — use the automatic JSX runtime, as next build does
  // Vite 8 (vitest ≥ 4) transforms with oxc and would keep Next's `jsx: preserve`; Vite ≤ 7 reads the esbuild key
  oxc: { jsx: { runtime: "automatic" } },
  esbuild: { jsx: "automatic" },
  test: {
    // fast-check property suites run 10,000+ cases; 5 s is too tight on a loaded runner
    testTimeout: 60_000,
    include: ["packages/**/test/**/*.test.ts", "apps/web/test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["packages/core/src/**", "apps/web/lib/**", "apps/web/app/api/plan/**"],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
  resolve: {
    alias: {
      "@glidepath/core": `${root}packages/core/src/index.ts`,
      "@": `${root}apps/web`,
    },
  },
});
