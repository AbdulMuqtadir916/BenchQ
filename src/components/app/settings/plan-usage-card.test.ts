import { createElement, type ComponentProps, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// See dashboard-errors.test.ts: in a server render the signed-in hooks read the live store.
vi.mock("@/lib/stores/session-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stores/session-store")>();
  return { ...actual, useSignedInUser: () => actual.useSession.getState().user!, useSignedInPrincipal: () => actual.useSession.getState().principal! };
});
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FirmProvider } from "@/lib/tenancy/firm-context";
import { firms } from "@/mocks/team";
import { stubBackendReads } from "@/mocks/fixture-backend";
import { signInAs, signOutForTest } from "@/mocks/sign-in-as";
import { useSession } from "@/lib/stores/session-store";
import { OwnerDashboard } from "@/features/dashboard/owner-dashboard";
import FirmSettingsPage from "@/app/[firm]/(app)/settings/firm/page";
import { PlanUsageCard } from "./plan-usage-card";

/**
 * settings/firm: the Plan and usage card shows the same seats and candidates as the OWNER dashboard (one function,
 * deriveFirmUsage, on the same records), and the page invents nothing: no shift window, no follow-up cadence (07 Q59).
 */

const firm = firms.find((item) => item.id === "firm_hts")!;

/** Signed in as `accountId`, render, let every query settle, render again; the page's text. */
async function textAs(accountId: string, component: ComponentType): Promise<string> {
  useSession.getState().setSession(await signInAs(accountId));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } } });
  const tree = () => renderToString(createElement(QueryClientProvider, { client }, createElement(FirmProvider, { firm } as ComponentProps<typeof FirmProvider>, createElement(component))));
  tree();
  await Promise.all(client.getQueryCache().getAll().map((query) => query.fetch()));
  return tree().replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

beforeEach(() => stubBackendReads());
afterEach(() => {
  vi.restoreAllMocks();
  useSession.getState().reset();
  signOutForTest();
});

describe("settings/firm (07 Q59)", { timeout: 20_000 }, () => {
  it("the Plan and usage card shows the dashboard's seats and candidates", async () => {
    const dashboard = await textAs("user_imran", OwnerDashboard);
    const card = await textAs("user_imran", PlanUsageCard);
    const seats = dashboard.match(/BDE seats used (\d+ \/ \d+)/)?.[1];
    const candidates = dashboard.match(/Assigned candidates (\d+ \/ \d+)/)?.[1];
    expect(seats).toBeDefined();
    expect(candidates).toBeDefined();
    expect(card).toContain(`BDE seats ${seats}`);
    expect(card).toContain(`Candidates ${candidates}`);
  });

  it("the OWNER sees the firm facts, the BDE capacity form and the usage card, and no invented rhythm", async () => {
    const page = await textAs("user_imran", FirmSettingsPage);
    expect(page).toContain(firm.name);
    expect(page).toContain("Ask BenchQ to change the firm name or timezones.");
    expect(page).toContain("Plan and usage");
    expect(page).toContain("candidates per BDE"); // the capacity form's unit
    expect(page).not.toMatch(/shift window|follow-up cadence|18:30|Day-3|Day-7/i);
  });
});
