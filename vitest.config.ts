import { defineConfig } from "vitest/config";
const root = new URL("./", import.meta.url).pathname;
export default defineConfig({
  test: {
    // fast-check property suites run 10,000+ cases; 5 s is too tight on a loaded runner
    testTimeout: 60_000,
    include: ["packages/**/test/**/*.test.ts", "apps/web/test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["packages/core/src/**", "apps/web/lib/**", "apps/web/app/api/plan/**"],
    },
  },
  resolve: {
    alias: {
      "@glidepath/core": `${root}packages/core/src/index.ts`,
      "@": `${root}apps/web`,
    },
  },
});
