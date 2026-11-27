import { describe, expect, it } from "vitest";
import { CSP_HEADER, CSP_REPORT_ONLY_HEADER, buildCsp, cspHeaderName, newNonce } from "./csp";

const directives = (csp: string) =>
  new Map(csp.split("; ").map((part) => {
    const [name, ...values] = part.split(" ");
    return [name, values] as const;
  }));

describe("buildCsp", () => {
  const prod = directives(buildCsp({ nonce: "abc123", isDev: false }));
  const dev = directives(buildCsp({ nonce: "abc123", isDev: true }));

  it("allows scripts by nonce only in production: no inline, no eval", () => {
    expect(prod.get("script-src")).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(prod.get("script-src")).not.toContain("'unsafe-inline'");
    expect(prod.get("script-src")).not.toContain("'unsafe-eval'");
  });

  it("refuses framing, plugins and foreign base or form targets", () => {
    expect(prod.get("frame-ancestors")).toEqual(["'none'"]);
    expect(prod.get("object-src")).toEqual(["'none'"]);
    expect(prod.get("base-uri")).toEqual(["'self'"]);
    expect(prod.get("form-action")).toEqual(["'self'"]);
    expect(prod.get("default-src")).toEqual(["'self'"]);
  });

  it("names only the external origins a screen uses", () => {
    expect(prod.get("img-src")).toEqual(["'self'", "https://www.google.com", "https://*.gstatic.com"]);
    expect(prod.get("frame-src")).toEqual(["https://linkedin.com", "https://*.linkedin.com"]);
    expect(prod.get("connect-src")).toEqual(["'self'"]);
  });

  it("has no upgrade-insecure-requests and no report endpoint", () => {
    expect(prod.has("upgrade-insecure-requests")).toBe(false);
    expect(prod.has("report-uri")).toBe(false);
    expect(prod.has("report-to")).toBe(false);
  });

  it("adds only 'unsafe-eval' to scripts and ws: to connections in development", () => {
    for (const [name, values] of dev) {
      const added = values.filter((value) => !prod.get(name)?.includes(value));
      if (name === "script-src") expect(added).toEqual(["'unsafe-eval'"]);
      else if (name === "connect-src") expect(added).toEqual(["ws:"]);
      else expect(added, name).toEqual([]);
    }
    expect([...dev.keys()]).toEqual([...prod.keys()]);
  });
});

describe("cspHeaderName", () => {
  it("enforces unless CSP_REPORT_ONLY is exactly true", () => {
    expect(cspHeaderName(undefined)).toBe(CSP_HEADER);
    expect(cspHeaderName("false")).toBe(CSP_HEADER);
    expect(cspHeaderName("1")).toBe(CSP_HEADER);
    expect(cspHeaderName("true")).toBe(CSP_REPORT_ONLY_HEADER);
  });
});

describe("newNonce", () => {
  it("is base64 and fresh each time", () => {
    const first = newNonce();
    expect(first).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(newNonce()).not.toBe(first);
  });
});
