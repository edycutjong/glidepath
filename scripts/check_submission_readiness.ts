/**
 * Submission readiness: everything a judge's clean clone depends on, checked mechanically. No network, no key.
 *   npm run check
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const add = (name: string, ok: boolean, detail = "") => checks.push({ name, ok, detail });
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const sh = (cmd: string) => {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    return String((e as { stdout?: string }).stdout ?? "") + "\n__FAILED__";
  }
};

// files a stranger needs
for (const f of ["README.md", "DEMO.md", "ARCHITECTURE.md", "LICENSE", "docs/SCORING.md", "docs/DX-REPORT.md", ".github/workflows/ci.yml", "package.json", ".gitignore"])
  add(`file ${f}`, existsSync(f));
const readme = read("README.md");
for (const s of ["Quickstart", "Nansen", "tests", "fixtures", "Why only Nansen", "License"]) add(`README mentions "${s}"`, readme.includes(s));
add("README has no TODO/TBD/lorem", !/\b(TODO|TBD|lorem ipsum|coming soon)\b/i.test(readme), "");
const shots = existsSync("docs/screenshots") ? readdirSync("docs/screenshots").filter((n) => n.endsWith(".png")) : [];
add(
  "docs/screenshots has 01..05.png",
  ["01", "02", "03", "04", "05"].every((n) => shots.some((s) => s.startsWith(n))),
  shots.join(", "),
);

// secrets and kitchen leaks
const gi = read(".gitignore");
for (const p of [".env", ".cache/", "node_modules/", ".next/", ".vercel"])
  add(
    `.gitignore covers ${p}`,
    gi.split("\n").some((l) => l.trim() === p || l.trim() === p.replace(/\/$/, "")),
  );
const tracked = sh("git ls-files").split("\n");
add("no kitchen files tracked (specs/, PROGRESS, project.json, CLAUDE.md, AGENTS.md, .claude/)", !tracked.some((f) => /^(specs\/|PROGRESS|project\.json|CLAUDE\.md|AGENTS\.md|\.claude\/)/.test(f)));
add("no .env or .cache tracked", !tracked.some((f) => /(^|\/)\.env|(^|\/)\.cache\//.test(f)));
const grep = sh("git grep -n -I -E 'nsn_[A-Za-z0-9]{20,}' -- . ':!fixtures' || true");
add("no nsn_ key in tracked files", !/nsn_[A-Za-z0-9]{20,}/.test(grep), grep.trim().slice(0, 200));
const hist = sh("git log -p --all | grep -c -E 'nsn_[A-Za-z0-9]{20,}' || true").trim();
add("no nsn_ key anywhere in git history", hist === "0" || hist === "", `matches: ${hist}`);
const fixKeys = sh("grep -l -E 'nsn_[A-Za-z0-9]{20,}' fixtures/*.json || true").trim();
add("fixtures carry no key", fixKeys === "", fixKeys);

// offline proof
const fixtures = existsSync("fixtures") ? readdirSync("fixtures").filter((n) => n.endsWith(".json")) : [];
add("fixtures recorded (≥ 10)", fixtures.length >= 10, `${fixtures.length} files`);
const verify = sh("NANSEN_OFFLINE=1 npx tsx scripts/verify.ts");
const m = verify.match(/(\d+)\/(\d+) plans reproduced offline/);
add("npm run verify reproduces every plan offline", !!m && m[1] === m[2] && !verify.includes("__FAILED__"), m ? `${m[1]}/${m[2]}` : verify.slice(-200));
// eslint-disable-next-line no-control-regex -- strips the ANSI colour codes vitest emits under CI so the count parses
const tests = sh("npx vitest run --reporter=dot 2>&1").replace(/\x1b\[[0-9;]*m/g, "");
const t = tests.match(/Tests\s+(\d+) passed/);
add("vitest green", !!t && !/failed/.test(tests), t ? `${t[1]} passed` : tests.slice(-300));
if (t) add("README states the test count", readme.includes(`${t[1]} tests`) || readme.includes(`${t[1]} vitest`), `looking for "${t[1]} tests"`);
const tc = sh("npx tsc -p tsconfig.json --noEmit");
add("typecheck clean", !tc.includes("__FAILED__") && !/error TS/.test(tc));

let bad = 0;
for (const c of checks) {
  if (!c.ok) bad++;
  console.log(`${c.ok ? "✔" : "✖"} ${c.name}${c.detail ? `  — ${c.detail}` : ""}`);
}
console.log(`\n${checks.length - bad}/${checks.length} checks pass`);
process.exit(bad ? 1 : 0);
