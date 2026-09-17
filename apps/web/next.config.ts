import type { NextConfig } from "next";
const config: NextConfig = {
  // Next 15 streams <meta> into <body> for non-bot user agents; Lighthouse/PSI only read <head>. The pages are tiny, so
  // give every UA blocking metadata — description/OG land in <head> for everyone, not just the bot allowlist.
  htmlLimitedBots: /./,
  // ~5 KB of CSS: inline it so first paint does not wait on a render-blocking stylesheet request (Lighthouse mobile)
  experimental: { inlineCss: true },
  transpilePackages: ["@glidepath/core"],
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
};
export default config;
