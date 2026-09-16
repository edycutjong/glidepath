import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@glidepath/core"],
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
};
export default config;
