import base from "./manifest.base.json" with { type: "json" };
import hosts from "./hosts.json" with { type: "json" };

/** A site and all its subdomains. `*.example.com` also matches `example.com`. */
const pattern = (domain: string) => `https://*.${domain}/*`;

/** Every site BenchQ may read without asking: the job boards, and the application systems whose forms it fills. Any other
 * site (an employer's own careers page) is asked for once, from the panel, the first time a BDE connects a job there. */
export const KNOWN_SITES = [...hosts.boards, ...hosts.applicationSystems].map(pattern);

const BROAD = new Set(["<all_urls>", "*://*/*", "http://*/*", "https://*/*"]);

/** The host of a match pattern such as `https://example.com/*`, or null when it has none to read. */
function hostOf(pattern: string): string | null {
  const match = /^[a-z*]+:\/\/([^/]+)\//.exec(pattern);
  // No port, no trailing dot ("localhost." is localhost), lower case.
  return match ? match[1].replace(/:\d+$/, "").replace(/\.$/, "").toLowerCase() : null;
}

/** An address, not a name: any IPv4 literal, or an IPv6 literal in brackets (which covers every way of writing a loopback
 * or mapped address, such as `[::ffff:127.0.0.1]`). A store build points at a domain name, never at one of these. */
const isIpLiteral = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");

/** A host on this machine by name. (Addresses are refused by `isIpLiteral`.) */
const isLocalHost = (host: string) => host === "localhost" || host.endsWith(".localhost");

const isLocalOrInsecure = (pattern: string) => {
  const host = hostOf(pattern);
  return !pattern.startsWith("https://") || host === null || isIpLiteral(host) || isLocalHost(host);
};

export interface ManifestOptions {
  /** The BenchQ website's address: what the extension signs in on and calls `/api/*` on. */
  benchqUrl: string;
  /** A build for the Chrome Web Store: exactly the production origin in hosts.json, nothing else. */
  isStore: boolean;
}

/** Why a manifest can't go to the store, or null. The store reviews broad access much more slowly, so it's checked here. */
export function storeProblem(manifest: { host_permissions?: string[]; optional_host_permissions?: string[] }): string | null {
  const required = manifest.host_permissions ?? [];
  const broad = required.find((host) => BROAD.has(host));
  if (broad) return `host_permissions has ${broad}: name the sites instead.`;
  const local = required.find(isLocalOrInsecure);
  if (local) return `host_permissions has ${local}: a store build is https only, and not local.`;
  // Optional sites may be broad (the panel asks for each one), but never local or plain http.
  const optional = (manifest.optional_host_permissions ?? []).find((host) => host !== "https://*/*" && isLocalOrInsecure(host));
  if (optional) return `optional_host_permissions has ${optional}: a store build is https only, and not local.`;
  return null;
}

/** The manifest for one build: the fixed parts in manifest.base.json, then the sites. The required sites are BenchQ and
 * the known boards and application systems; every other https site is optional, for the panel to ask about. */
export function buildManifest({ benchqUrl, isStore }: ManifestOptions) {
  const url = new URL(benchqUrl);
  const origin = url.origin;
  // The bundle calls `${origin}/api/...`, so a store build's BENCHQ_URL is a bare origin: no path, query, fragment or login.
  if (isStore && (url.pathname !== "/" || url.search || url.hash || url.username || url.password)) {
    throw new Error(`Not a store manifest: BENCHQ_URL must be a bare origin such as ${hosts.storeOrigin}, not ${benchqUrl}.`);
  }
  // The store build is checked against the one origin it is meant for, not against a list of bad ones: any other
  // spelling of a local address, or a staging site, fails here.
  if (isStore && origin !== hosts.storeOrigin) {
    throw new Error(`Not a store manifest: BENCHQ_URL is ${origin}, but a store build must use ${hosts.storeOrigin} (storeOrigin in hosts.json).`);
  }
  const manifest = {
    ...base,
    host_permissions: [`${origin}/*`, ...KNOWN_SITES],
    optional_host_permissions: ["https://*/*"],
  };
  const problem = isStore ? storeProblem(manifest) : null;
  if (problem) throw new Error(`Not a store manifest: ${problem}`);
  return manifest;
}
