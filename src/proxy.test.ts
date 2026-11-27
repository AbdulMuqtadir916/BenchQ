import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "./proxy";
import { SESSION_COOKIE } from "@/lib/routes/proxy-access";
import { PATH_HEADER } from "@/lib/server/path-header";
import { CSP_HEADER, CSP_REPORT_ONLY_HEADER, NONCE_HEADER } from "@/lib/security/csp";

// NextResponse.next({ request: { headers } }) hands the new request headers to Next as `x-middleware-request-<name>`.
const forwarded = (response: Response, name: string) => response.headers.get(`x-middleware-request-${name.toLowerCase()}`);
const nonceOf = (csp: string | null) => csp?.match(/'nonce-([^']+)'/)?.[1];
const PREFETCH = { "next-router-prefetch": "1", rsc: "1" };

function request(path: string, init: { isSignedIn?: boolean; headers?: Record<string, string> } = {}) {
  const headers = new Headers(init.headers);
  if (init.isSignedIn ?? true) headers.set("cookie", `${SESSION_COOKIE}=s`);
  return new NextRequest(new URL(path, "http://localhost:3000"), { headers });
}

afterEach(() => vi.unstubAllEnvs());

describe("proxy", () => {
  it("sets a fresh nonce on every request, the same one in the request and the response policy", () => {
    const first = proxy(request("/gsc/dashboard"));
    const second = proxy(request("/gsc/dashboard"));
    const nonce = nonceOf(first.headers.get(CSP_HEADER));
    expect(nonce).toBeTruthy();
    expect(nonceOf(forwarded(first, CSP_HEADER))).toBe(nonce);
    expect(forwarded(first, NONCE_HEADER)).toBe(nonce);
    expect(nonceOf(second.headers.get(CSP_HEADER))).not.toBe(nonce);
    expect(first.headers.get(CSP_REPORT_ONLY_HEADER)).toBeNull();
  });

  it("sends the policy as Report-Only when CSP_REPORT_ONLY=true", () => {
    vi.stubEnv("CSP_REPORT_ONLY", "true");
    const response = proxy(request("/gsc/dashboard"));
    expect(response.headers.get(CSP_HEADER)).toBeNull();
    const csp = response.headers.get(CSP_REPORT_ONLY_HEADER);
    expect(nonceOf(csp)).toBeTruthy();
    expect(forwarded(response, CSP_REPORT_ONLY_HEADER)).toBe(csp);
    expect(forwarded(response, CSP_HEADER)).toBeNull();
  });

  it("drops a policy the browser sent, so Next never takes its nonce from the client", () => {
    vi.stubEnv("CSP_REPORT_ONLY", "true");
    const response = proxy(request("/gsc/dashboard", { headers: { [CSP_HEADER]: "script-src 'nonce-evil'" } }));
    expect(forwarded(response, CSP_HEADER)).toBeNull();
    expect(nonceOf(forwarded(response, CSP_REPORT_ONLY_HEADER))).not.toBe("evil");
  });

  it("still gives a prefetch the path header, for the server gates", () => {
    const response = proxy(request("/gsc/candidates?tab=all", { headers: PREFETCH }));
    expect(forwarded(response, PATH_HEADER)).toBe("/gsc/candidates?tab=all");
  });

  it("still sends a signed-out visitor to sign-in, prefetch or not", () => {
    for (const headers of [{}, PREFETCH]) {
      const response = proxy(request("/gsc/dashboard", { isSignedIn: false, headers }));
      expect(response.status).toBe(307);
      const location = new URL(response.headers.get("location") ?? "");
      expect(location.pathname).toBe("/sign-in");
      expect(location.searchParams.get("returnTo")).toBe("/gsc/dashboard");
    }
  });

  it("lets a signed-out visitor open a public page, with the policy", () => {
    const response = proxy(request("/sign-in", { isSignedIn: false }));
    expect(response.headers.get("location")).toBeNull();
    expect(nonceOf(response.headers.get(CSP_HEADER))).toBeTruthy();
  });
});

describe("proxy matcher", () => {
  const runsOn = (path: string) => unstable_doesMiddlewareMatch({ config, url: path });

  it("runs on every page, including a firm whose slug starts with health or api", () => {
    for (const path of ["/", "/sign-in", "/gsc/dashboard", "/healthy-firm/jobs", "/healthcare-staffing/dashboard", "/apiary/jobs"]) {
      expect(runsOn(path), path).toBe(true);
    }
  });

  it("skips the backend's paths, Next's files and files with an extension", () => {
    for (const path of ["/health", "/api", "/api/", "/api/x", "/api/auth/me", "/_next/static/chunks/a.js", "/icon.png", "/resume-highlight.css"]) {
      expect(runsOn(path), path).toBe(false);
    }
  });
});
