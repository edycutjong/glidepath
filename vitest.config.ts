import { defineConfig } from "vitest/config";
const root = new URL("./", import.meta.url).pathname;
export default defineConfig({
  test: {
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
