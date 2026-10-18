import { createElement, type ComponentProps, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FirmProvider } from "@/lib/tenancy/firm-context";
import { DEFAULT_SESSION } from "@/lib/stores/session-store";
import { OwnerDashboard } from "./owner-dashboard";
import { ManagerDashboard } from "./manager-dashboard";
import { BdeDashboard } from "./bde-dashboard";

/**
 * docs/04 §13 on the four dashboards: a card group whose data failed shows an error with Retry,
 * never a number; only when every query fails does the page show one page-level error. Rendered on
 * the real hooks and the mock backend; failures come from the dev fault switch.
 */

type Resource = "candidates" | "applications" | "followups" | "team" | "jobs";
type Dashboard = { name: string; component: ComponentType; queries: Resource[]; groups: Record<string, { reads: Resource[]; labels: string[] }> };

const floorGroups = {
  throughput: { reads: ["candidates", "applications", "team"] as Resource[], labels: ["Applied today", "Active BDEs", "Candidates on bench"] },
  performance: { reads: ["team", "candidates", "applications", "followups"] as Resource[], labels: ["Interviews"] },
  pipeline: { reads: ["applications"] as Resource[], labels: [] },
  risk: { reads: ["candidates", "applications"] as Resource[], labels: [] },
};

const DASHBOARDS: Dashboard[] = [
  { name: "OWNER", component: OwnerDashboard, queries: ["candidates", "applications", "followups", "team"], groups: { rollups: { reads: ["applications", "candidates", "team"], labels: ["Time to place", "Active users", "Active candidates"] }, ...floorGroups } },
  { name: "MANAGER", component: () => createElement(ManagerDashboard, { role: "MANAGER" }), queries: ["candidates", "applications", "followups", "team"], groups: floorGroups },
  { name: "VIEWER", component: () => createElement(ManagerDashboard, { role: "VIEWER" }), queries: ["candidates", "applications", "followups", "team"], groups: floorGroups },
  { name: "BDE", component: BdeDashboard, queries: ["candidates", "applications", "followups", "jobs"], groups: {
    numbers: { reads: ["candidates", "applications", "followups"], labels: ["Unverified claims", "Responses"] },
    mine: { reads: ["candidates", "applications"], labels: ["apps</span>"] }, // per-candidate app counts in the list body
    queue: { reads: ["candidates", "applications", "jobs"], labels: ["Tailor resume"] }, // the queue rows' action
  } },
];

const ERROR = "Something didn’t load";
const fault = globalThis as { __BENCHQ_MOCK_FAIL__?: string[] };

/** Render, let every query the dashboard created settle (some failing), render again. */
async function render(component: ComponentType, failing: Resource[]): Promise<string> {
  // retryOnMount off: a fresh render would otherwise report a failed query as loading again (it retries on mount).
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } } });
  const tree = () => renderToString(createElement(QueryClientProvider, { client }, createElement(FirmProvider, { firm: DEFAULT_SESSION.firm } as ComponentProps<typeof FirmProvider>, createElement(component))));
  tree(); // creates the queries the dashboard reads
  fault.__BENCHQ_MOCK_FAIL__ = failing.map((resource) => `${resource}.list`);
  await Promise.all(client.getQueryCache().getAll().map((query) => query.fetch().catch(() => undefined)));
  fault.__BENCHQ_MOCK_FAIL__ = [];
  return tree();
}
const count = (html: string, text: string) => html.split(text).length - 1;

afterEach(() => {
  fault.__BENCHQ_MOCK_FAIL__ = [];
});

describe.each(DASHBOARDS)("$name dashboard (docs/04 §13)", { timeout: 20_000 }, ({ component, queries, groups }) => {
  it("renders every group, with no error, when the data loads", async () => {
    const html = await render(component, []);
    expect(count(html, ERROR)).toBe(0);
    // Firm pages can't read pending invites yet, so no firm page may claim a seat count (A1): /admin's would differ.
    expect(html).not.toContain("Seats used");
    for (const group of Object.values(groups)) for (const label of group.labels) expect(html, label).toContain(label);
  });

  it.each(queries)("one failing query (%s): exactly the groups that read it show an error with Retry, and none of their numbers", async (failing) => {
    const html = await render(component, [failing]);
    const hit = Object.entries(groups).filter(([, group]) => group.reads.includes(failing));
    expect(count(html, ERROR)).toBe(hit.length);
    expect(count(html, ">Retry<")).toBe(hit.length);
    for (const [, group] of hit) for (const label of group.labels) expect(html, label).not.toContain(label);
    for (const [, group] of Object.entries(groups).filter(([, g]) => !g.reads.includes(failing))) for (const label of group.labels) expect(html, label).toContain(label);
  });

  it("every query failing: one page-level error, no cards", async () => {
    const html = await render(component, queries);
    expect(count(html, ERROR)).toBe(1);
    expect(count(html, ">Retry<")).toBe(1);
    for (const group of Object.values(groups)) for (const label of group.labels) expect(html, label).not.toContain(label);
  });
});
