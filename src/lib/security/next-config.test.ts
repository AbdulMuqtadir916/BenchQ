import { afterEach, describe, expect, it, vi } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import nextConfig from "../../../next.config";

afterEach(() => vi.unstubAllEnvs());

/** The headers next.config gives a path, matched the way Next matches a header `source` (strict, case-insensitive). */
async function headerRules() {
  const rules = (await nextConfig.headers?.()) ?? [];
  return (path: string) =>
    rules.filter((rule) => getPathMatch(rule.source, { strict: true })(path) !== false).flatMap((rule) => rule.headers);
}

const PAGE_HEADER_KEYS = ["X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Cross-Origin-Opener-Policy", "Permissions-Policy"];

describe("next.config security headers", () => {
  it("hides X-Powered-By", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("sets the page headers on page paths", async () => {
    const headersFor = await headerRules();
    for (const path of ["/", "/sign-in", "/privacy", "/gsc/dashboard", "/admin/firms", "/healthy-firm/jobs", "/apiary"]) {
      expect(headersFor(path).map((h) => h.key), path).toEqual(expect.arrayContaining(PAGE_HEADER_KEYS));
    }
    const value = (key: string) => headersFor("/sign-in").find((h) => h.key === key)?.value;
    expect(value("X-Frame-Options")).toBe("DENY");
    expect(value("X-Content-Type-Options")).toBe("nosniff");
    expect(value("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(value("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(value("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()");
  });

  it("leaves the backend's paths alone: /api and /health set their own", async () => {
    const headersFor = await headerRules();
    for (const path of ["/api", "/api/", "/api/firms/1/candidates", "/health", "/HEALTH", "/Api/session"]) {
      expect(headersFor(path), path).toEqual([]);
    }
  });

  it("never sends HSTS, in development or production: the deployment's proxy sets it", async () => {
    for (const mode of ["development", "production"]) {
      vi.stubEnv("NODE_ENV", mode);
      const rules = (await nextConfig.headers?.()) ?? [];
      const keys = rules.flatMap((rule) => rule.headers.map((h) => h.key.toLowerCase()));
      expect(keys, mode).not.toContain("strict-transport-security");
    }
  });
});
