import { createElement, type ComponentProps, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// See dashboard-errors.test.ts: in a server render the signed-in hooks read the live store.
vi.mock("@/lib/stores/session-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/stores/session-store")>();
  return { ...actual, useSignedInUser: () => actual.useSession.getState().user!, useSignedInPrincipal: () => actual.useSession.getState().principal! };
});
// The admin firm pages read their firm id from the route.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useParams: () => ({ firmId: "firm_hts" }),
}));
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FirmProvider } from "@/lib/tenancy/firm-context";
import { firms } from "@/mocks/team";
import { invites } from "@/mocks/tenancy";
import { isSeatReservingInvite } from "@/lib/derive";
import { stubBackendReads } from "@/mocks/fixture-backend";
import { signInAs, signOutForTest } from "@/mocks/sign-in-as";
import { useSession } from "@/lib/stores/session-store";
import { FirmOverviewTab } from "@/features/admin/firm/overview-tab";
import { OwnerDashboard } from "./owner-dashboard";

/**
 * docs/07 M3: the OWNER's "Seats used" card and /admin's firm page come from the same function
 * (deriveFirmUsage) on the same records, so for one fixture state they show the same number.
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

const seatsUsed = (text: string) => text.match(/Seats used (\d+ \/ \d+)/)?.[1];

beforeEach(() => stubBackendReads());
afterEach(() => {
  vi.restoreAllMocks();
  useSession.getState().reset();
  signOutForTest();
});

describe("Seats used (docs/07 M3, A1)", { timeout: 20_000 }, () => {
  it("the OWNER's dashboard and /admin show the same seats for the firm, pending invites included", async () => {
    const owner = await textAs("user_imran", OwnerDashboard);
    const admin = await textAs("padm_sana", FirmOverviewTab);
    expect(seatsUsed(owner)).toBeDefined();
    expect(seatsUsed(owner)).toBe(seatsUsed(admin));

    const pending = invites.filter((invite) => invite.firmId === firm.id && isSeatReservingInvite(invite, new Date())).length;
    expect(pending).toBeGreaterThan(0); // the fixture has a pending invite, so the check means something
    expect(owner).toContain(`+ ${pending} pending`);
  });
});
