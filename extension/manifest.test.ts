import { describe, expect, it } from "vitest";
import hosts from "./hosts.json" with { type: "json" };
import { buildManifest, KNOWN_SITES, storeProblem } from "./manifest";

const STORE = { benchqUrl: hosts.storeOrigin, isStore: true };

describe("the extension's manifest", () => {
  it("asks for BenchQ and the known job sites, and no more, outright", () => {
    const { host_permissions } = buildManifest(STORE);
    expect(host_permissions[0]).toBe(`${hosts.storeOrigin}/*`);
    expect(host_permissions.slice(1)).toEqual(KNOWN_SITES);
    expect(host_permissions).toHaveLength(1 + hosts.boards.length + hosts.applicationSystems.length);
    expect(host_permissions.some((host) => host.includes("localhost") || host === "https://*/*")).toBe(false);
  });

  it("leaves every other https site to be asked for, from the panel", () => {
    expect(buildManifest(STORE).optional_host_permissions).toEqual(["https://*/*"]);
  });

  it("keeps what the extension does: its permissions, panel, shortcuts and icons", () => {
    const manifest = buildManifest(STORE);
    expect(manifest.permissions).toEqual(["sidePanel", "scripting", "storage", "webNavigation"]);
    expect(manifest.side_panel).toEqual({ default_path: "index.html" });
    expect(Object.keys(manifest.commands)).toEqual(["run-autofill", "mark-applied"]);
    expect(manifest.background.service_worker).toBe("background.js");
    expect(Number(manifest.minimum_chrome_version)).toBeGreaterThanOrEqual(114); // the side panel API
  });

  it("lets a local build call its own BenchQ", () => {
    const manifest = buildManifest({ benchqUrl: "http://localhost:3000", isStore: false });
    expect(manifest.host_permissions[0]).toBe("http://localhost:3000/*");
  });

  it("refuses a store build that asks for everything, or for a local address", () => {
    expect(() => buildManifest({ benchqUrl: "http://localhost:3000", isStore: true })).toThrow(/Not a store manifest/);
    expect(storeProblem({ host_permissions: ["https://*/*"] })).toMatch(/name the sites/);
    expect(storeProblem({ host_permissions: ["<all_urls>"] })).toMatch(/name the sites/);
    expect(storeProblem({ host_permissions: ["https://a.test/*", "http://localhost:3000/*"] })).toMatch(/https only/);
    expect(storeProblem({ host_permissions: ["https://a.test/*", ...KNOWN_SITES] })).toBeNull();
  });

  it("refuses any address on this machine, however it is written", () => {
    for (const host of ["https://127.0.0.2/*", "https://localhost:8443/*", "https://localhost./*", "https://LOCALHOST./*", "https://app.localhost/*",
      "https://0.0.0.0/*", "https://10.0.0.5/*", "https://[::1]/*", "https://[::1]:3000/*", "https://[::ffff:127.0.0.1]/*", "https://[::ffff:7f00:1]/*"]) {
      expect(storeProblem({ host_permissions: [host] }), host).toMatch(/not local/);
    }
  });

  it("builds a store manifest only for the production origin, so no other address or spelling gets through", () => {
    for (const url of ["https://127.0.0.2", "https://localhost.", "https://[::ffff:127.0.0.1]", "https://[::ffff:7f00:1]", "https://10.0.0.5",
      "https://staging.benchq.io", "https://www.benchq.io.evil.test", "https://app.benchq.test", "http://www.benchq.io"]) {
      expect(() => buildManifest({ benchqUrl: url, isStore: true }), url).toThrow(/Not a store manifest/);
    }
    expect(() => buildManifest(STORE)).not.toThrow();
  });

  it("checks the optional sites too: all of https is allowed there, a local or plain http one is not", () => {
    expect(storeProblem({ host_permissions: ["https://a.test/*"], optional_host_permissions: ["https://*/*"] })).toBeNull();
    expect(storeProblem({ host_permissions: ["https://a.test/*"], optional_host_permissions: ["http://*/*"] })).toMatch(/optional_host_permissions/);
    expect(storeProblem({ host_permissions: ["https://a.test/*"], optional_host_permissions: ["https://localhost/*"] })).toMatch(/optional_host_permissions/);
  });

  it("names every site as a domain and its subdomains, over https", () => {
    for (const site of KNOWN_SITES) expect(site).toMatch(/^https:\/\/\*\.[a-z0-9.-]+\/\*$/);
  });
});
