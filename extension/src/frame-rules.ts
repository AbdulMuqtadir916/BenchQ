/**
 * LinkedIn postings inside BenchQ (decided 2026-11-17, Q106, Q115: JobNavigator's own rules, fitted to BenchQ).
 *
 * BenchQ's job pane shows a LinkedIn job's page in a frame, which LinkedIn refuses (X-Frame-Options / CSP
 * frame-ancestors). These rules lift that for frames BenchQ itself opens and nothing else: sub_frame only, and only
 * when the request's initiator is BenchQ's host. A top-level page, or a frame opened by any other site, keeps its
 * headers. BenchQ's own responses are never touched. The panel's "Posting preview" switch (`previewUnblock`, on unless
 * turned off) removes the rules entirely. The rules only reach sites this extension may read (host_permissions:
 * BenchQ, and the job boards in hosts.json, LinkedIn among them).
 */
import { BENCHQ_URL } from "./api";

export const PREVIEW_KEY = "previewUnblock";
const RULE_IDS = [1, 2];

/** BenchQ's host, the frames' initiator. */
export function benchqHost(url: string = BENCHQ_URL): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "localhost";
  }
}

/** The two session rules, as JobNavigator's extension writes them. */
export function frameRules(host: string) {
  const condition = {
    urlFilter: "*",
    resourceTypes: ["sub_frame"],
    initiatorDomains: [host],
    // never BenchQ's own responses
    excludedRequestDomains: [host],
  };
  return [
    {
      id: 1,
      priority: 1,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          { header: "x-frame-options", operation: "remove" },
          { header: "content-security-policy", operation: "remove" },
        ],
      },
      condition,
    },
    {
      id: 2,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "sec-fetch-dest", operation: "set", value: "document" },
          { header: "sec-fetch-site", operation: "set", value: "none" },
        ],
      },
      condition,
    },
  ];
}

/** Install the rules, or take them away when the switch is off. Safe to run again (it replaces them). */
export async function setupFrameRules(): Promise<void> {
  const settings = await chrome.storage.sync.get([PREVIEW_KEY]);
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: RULE_IDS });
  if (settings[PREVIEW_KEY] === false) return;
  await chrome.declarativeNetRequest.updateSessionRules({ addRules: frameRules(benchqHost()) });
}
