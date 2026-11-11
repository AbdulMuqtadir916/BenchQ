import { createElement, type ComponentProps, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The Activity tab is URL state; a server render has no app router, so it gets a still one showing that tab.
const search = { value: "view=activity" };
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search.value),
  usePathname: () => "/hyderabad-tech-staffing/dashboard",
}));
vi.mock("@/lib/stores/session-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stores/session-store")>();
  return { ...actual, useSignedInUser: () => actual.useSession.getState().user!, useSignedInPrincipal: () => actual.useSession.getState().principal! };
});
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FirmProvider } from "@/lib/tenancy/firm-context";
import { allUsers, firms } from "@/mocks/team";
import { stubBackendReads } from "@/mocks/fixture-backend";
import { signInAs, signOutForTest } from "@/mocks/sign-in-as";
import { useSession } from "@/lib/stores/session-store";
import { OwnerDashboard } from "./owner-dashboard";
import { ManagerDashboard } from "./manager-dashboard";
import ApplicationsPage from "@/app/[firm]/(app)/(workspace)/applications/page";
import CandidatesPage from "@/app/[firm]/(app)/(workspace)/candidates/page";

/** Render, let every query the tab created settle, render again: the loaded tab, on the mock backend. */
async function render(component: ComponentType): Promise<string> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } } });
  const tree = () => renderToString(createElement(QueryClientProvider, { client }, createElement(FirmProvider, { firm: firms.find((firm) => firm.id === "firm_hts")! } as ComponentProps<typeof FirmProvider>, createElement(component))));
  tree();
  await Promise.all(client.getQueryCache().getAll().map((query) => query.fetch().catch(() => undefined)));
  return tree();
}

const as = async (account: string) => useSession.getState().setSession(await signInAs(account));

describe("the Activity tab (07 Q47)", { timeout: 20_000 }, () => {
  beforeAll(() => stubBackendReads());
  afterAll(() => {
    vi.restoreAllMocks();
    useSession.getState().reset();
    signOutForTest();
  });

  it("shows the owner the whole firm, with every number linking to its list", async () => {
    search.value = "view=activity";
    await as("user_imran");
    const html = await render(OwnerDashboard);
    for (const text of ["Whole firm", "Pipeline", "Bench aging", "Managers", "Time between stages", "Every BDE", "Bench placed"]) expect(html, text).toContain(text);
    expect(html).toContain("/hyderabad-tech-staffing/applications?period=30d&amp;by=applied&amp;view=table");
    expect(html).toContain("/hyderabad-tech-staffing/candidates?bench=under30");
    expect(html).not.toContain("Something didn’t load");
  });

  it("shows a manager only their own team, with no way up to the firm", async () => {
    search.value = "view=activity&manager=user_priya";
    await as("user_fatima");
    const html = await render(() => createElement(ManagerDashboard, { role: "MANAGER" }));
    expect(html).toContain("Fatima Reddy");
    expect(html).not.toContain("Whole firm");
    expect(html).not.toContain("Priya Shah");
    for (const text of ["Submissions by BDE", "View submission counts", "Waiting for a BDE", "Team activity", "Job sources"]) expect(html, text).toContain(text);
    expect(html).toContain("manager=user_fatima");
  });

  it("keeps both the manager and BDE in activity links from the BDE level", async () => {
    const bde = allUsers.find((user) => user.role === "BDE" && user.managerId === "user_fatima")!;
    search.value = `view=activity&manager=user_fatima&bde=${bde.id}`;
    await as("user_imran");
    const html = await render(OwnerDashboard);
    const filters = `manager=user_fatima&amp;bde=${bde.id}`;
    expect(html).toContain(`/hyderabad-tech-staffing/applications?${filters}&amp;period=1d&amp;view=table`);
    expect(html).toContain(`/hyderabad-tech-staffing/candidates?${filters}&amp;bench=under30`);
  });

  it("does not resolve out-of-team names on a manager's drill-down links", async () => {
    search.value = "manager=user_priya";
    await as("user_fatima");
    for (const page of [ApplicationsPage, CandidatesPage]) {
      const html = await render(page);
      expect(html).toContain("Unknown team member");
      expect(html).not.toContain("Priya Shah");
    }
  });

  it("shows a viewer the firm, with nothing to act on", async () => {
    search.value = "view=activity";
    await as("user_rohan");
    const html = await render(() => createElement(ManagerDashboard, { role: "VIEWER" }));
    expect(html).toContain("Whole firm");
    expect(html).toContain("Firm activity");
    expect(html).not.toContain(">Assign<");
  });

  it("gives a manager only the activity dashboard: no floor, no tabs, whatever the URL says", async () => {
    search.value = "";
    await as("user_fatima");
    const html = await render(() => createElement(ManagerDashboard, { role: "MANAGER" }));
    expect(html).toContain("Team activity");
    expect(html).not.toContain("The floor");
    expect(html).not.toContain(">Activity dashboard<"); // the tab button; the region is still labelled
    expect(html).not.toContain("Dashboard views");
  });

  it("shows a manager how far each BDE's applications got, each opening that BDE", async () => {
    search.value = "view=activity";
    await as("user_fatima");
    const html = await render(() => createElement(ManagerDashboard, { role: "MANAGER" }));
    for (const text of ["How far each BDE", "Shortlisted", "Open their dashboard"]) expect(html, text).toContain(text);
  });
});
