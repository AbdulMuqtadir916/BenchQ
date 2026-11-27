#!/usr/bin/env node
/**
 * Checks the built app's page security headers end to end (production layer step 6). Run after `pnpm build`:
 *
 *   node scripts/check-csp.mjs
 *
 * 1. No page was prerendered: a static page would carry one build-time nonce, or none, and the CSP would block it.
 * 2. `next start` on CHECK_CSP_PORT (default 3100), once enforced and once with CSP_REPORT_ONLY=true, and for the
 *    public pages: the policy is under the right header name, its nonce is fresh per request, every <script> carries
 *    that nonce, the next.config headers are there, and neither HSTS (the deployment's proxy sets it) nor
 *    X-Powered-By is. /api and /health (the backend's) get none of them; a firm
 *    whose slug starts with "health" still gets the policy and the signed-out redirect.
 *
 * Runs without a backend: only public pages are rendered in full. Lists every failed check, then exits non-zero.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const PORT = process.env.CHECK_CSP_PORT ?? "3100";
const ORIGIN = `http://localhost:${PORT}`;
const MUST_RENDER = ["/sign-in", "/privacy"];
const ALSO_CHECK = ["/", "/forgot-password", "/reset-password"];
const BACKEND_PATHS = ["/api/auth/me", "/api", "/health"];
const PAGE_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
};
// The app never sends these: HSTS is the deployment's Caddy proxy's (Abdul, 2026-11-24), and X-Powered-By is off.
const NEVER_SENT = ["strict-transport-security", "x-powered-by"];

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

function checkNothingPrerendered() {
  const manifestPath = join(ROOT, ".next", "prerender-manifest.json");
  if (!existsSync(manifestPath)) throw new Error("No .next/prerender-manifest.json: run `pnpm build` first.");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  // Files such as /icon.png are static by design; a page path has no extension.
  const staticPages = Object.keys(manifest.routes ?? {}).filter((route) => !/\.[a-z0-9]+$/i.test(route));
  check(staticPages.length === 0, `Prerendered (static) pages, which can't carry a nonce: ${staticPages.join(", ")}`);
}

function startServer(reportOnly) {
  const nextBin = createRequire(join(ROOT, "package.json")).resolve("next/dist/bin/next");
  const env = { ...process.env, CSP_REPORT_ONLY: reportOnly ? "true" : "false" };
  const server = spawn(process.execPath, [nextBin, "start", "-p", PORT], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  server.stdout.on("data", (chunk) => (output += chunk));
  server.stderr.on("data", (chunk) => (output += chunk));
  return { server, output: () => output };
}

async function waitUntilUp(started) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (started.server.exitCode !== null) throw new Error(`next start exited:\n${started.output()}`);
    try {
      await fetch(`${ORIGIN}/sign-in`, { redirect: "manual" });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`next start did not answer on ${ORIGIN} within 60 s:\n${started.output()}`);
}

const nonceOf = (csp) => csp?.match(/'nonce-([^']+)'/)?.[1];

async function checkPage(path, reportOnly, mustRender) {
  const label = `${reportOnly ? "[report-only]" : "[enforced]"} ${path}`;
  const response = await fetch(`${ORIGIN}${path}`, { redirect: "manual" });
  if (!mustRender && response.status >= 300 && response.status < 400) return;
  check(response.status === 200, `${label}: status ${response.status}, expected 200`);

  const enforced = response.headers.get("content-security-policy");
  const reported = response.headers.get("content-security-policy-report-only");
  const csp = reportOnly ? reported : enforced;
  check(Boolean(csp), `${label}: no ${reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy"} header`);
  check(!(reportOnly ? enforced : reported), `${label}: both CSP headers are set`);
  check(!/'unsafe-eval'|'unsafe-inline'/.test(csp?.match(/script-src[^;]*/)?.[0] ?? ""), `${label}: script-src allows inline or eval`);
  const nonce = nonceOf(csp);
  check(Boolean(nonce), `${label}: the policy has no nonce`);

  for (const [name, value] of Object.entries(PAGE_HEADERS)) {
    check(response.headers.get(name) === value, `${label}: ${name} is ${JSON.stringify(response.headers.get(name))}, expected ${JSON.stringify(value)}`);
  }
  for (const name of NEVER_SENT) check(!response.headers.has(name), `${label}: ${name} is set; the app must not send it`);

  const html = await response.text();
  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map((match) => match[1]);
  check(scripts.length > 0, `${label}: no <script> tags in the page`);
  for (const attributes of scripts) {
    // A JSON data block isn't run, so the policy doesn't apply to it.
    if (/\btype="application\/(ld\+)?json"/i.test(attributes)) continue;
    const scriptNonce = attributes.match(/\bnonce="([^"]*)"/)?.[1];
    check(scriptNonce === nonce, `${label}: a <script${attributes}> doesn't carry the header's nonce`);
  }

  const again = await fetch(`${ORIGIN}${path}`, { redirect: "manual" });
  const againCsp = again.headers.get(reportOnly ? "content-security-policy-report-only" : "content-security-policy");
  check(nonceOf(againCsp) !== nonce, `${label}: the nonce repeats across requests`);
}

/**
 * /api and /health are the backend's, and the app adds nothing to them. With no backend answering (CI: the build has
 * no BACKEND_URL), none of the page headers may be there. When the backend answered (it tags every response with
 * `x-request-id`), its own security headers are expected, so the check is that the app added nothing on top: no
 * nonce policy, no header sent twice (Headers joins repeats with ", "), and nothing from NEVER_SENT.
 */
async function checkBackendPath(path) {
  const response = await fetch(`${ORIGIN}${path}`, { redirect: "manual" });
  const policyNames = ["content-security-policy", "content-security-policy-report-only"];
  for (const name of NEVER_SENT) check(!response.headers.has(name), `${path}: ${name} is set; the app must not send it`);
  if (!response.headers.has("x-request-id")) {
    for (const name of [...Object.keys(PAGE_HEADERS), ...policyNames]) {
      check(!response.headers.has(name), `${path}: the app set ${name}; the backend's paths keep their own headers`);
    }
    return;
  }
  check(!policyNames.some((name) => nonceOf(response.headers.get(name))), `${path}: the app's nonce policy is on a backend path`);
  // Permissions-Policy is left out: its own value is a ", " list.
  for (const name of ["x-content-type-options", "x-frame-options", "referrer-policy", "cross-origin-opener-policy", ...policyNames]) {
    check(!response.headers.get(name)?.includes(", "), `${path}: ${name} is sent twice: ${response.headers.get(name)}`);
  }
}

/**
 * A firm whose slug starts with "health" is a page, so the proxy runs on it (its matcher skips exactly /health). With a
 * session cookie the proxy lets the request through, so its policy is on the response whatever the page then answers
 * (no backend here, so the session lookup fails). Signed out, it still goes to sign-in.
 */
async function checkHealthPrefixedFirm(reportOnly) {
  const path = "/healthy-firm/jobs";
  const label = `${reportOnly ? "[report-only]" : "[enforced]"} ${path}`;
  const signedIn = await fetch(`${ORIGIN}${path}`, { redirect: "manual", headers: { cookie: "bq_session=check-csp" } });
  const csp = signedIn.headers.get(reportOnly ? "content-security-policy-report-only" : "content-security-policy");
  check(Boolean(nonceOf(csp)), `${label}: no policy with a nonce (status ${signedIn.status}); the proxy didn't run`);
  const signedOut = await fetch(`${ORIGIN}${path}`, { redirect: "manual" });
  const location = signedOut.headers.get("location");
  check(signedOut.status === 307 && location !== null && new URL(location, ORIGIN).pathname === "/sign-in",
    `${label}: signed out, status ${signedOut.status} to ${location}; expected a redirect to sign-in`);
}

const portRefuses = async () => {
  try {
    await fetch(`${ORIGIN}/sign-in`, { redirect: "manual" });
    return false;
  } catch {
    return true;
  }
};

/** Stops the server and waits until it has exited and the port refuses connections, so the next run can't reach it. */
async function stopServer(started) {
  if (started.server.exitCode === null && started.server.signalCode === null) {
    const exited = new Promise((resolve) => started.server.once("exit", resolve));
    started.server.kill();
    await exited;
  }
  const deadline = Date.now() + 30_000;
  while (!(await portRefuses())) {
    if (Date.now() > deadline) throw new Error(`Port ${PORT} still answers after next start exited.`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function run(reportOnly) {
  const started = startServer(reportOnly);
  try {
    await waitUntilUp(started);
    for (const path of MUST_RENDER) await checkPage(path, reportOnly, true);
    for (const path of ALSO_CHECK) await checkPage(path, reportOnly, false);
    await checkHealthPrefixedFirm(reportOnly);
    if (!reportOnly) for (const path of BACKEND_PATHS) await checkBackendPath(path);
  } finally {
    await stopServer(started);
  }
}

// Something else on the port would answer for the server under test.
if (!(await portRefuses())) throw new Error(`Port ${PORT} is already in use: stop what runs there or set CHECK_CSP_PORT.`);
checkNothingPrerendered();
await run(false);
await run(true);

if (failures.length) {
  console.error(`check-csp: ${failures.length} failed check(s):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("check-csp: page headers and CSP nonces OK (enforced and report-only).");
