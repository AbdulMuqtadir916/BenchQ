import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { sessionApi } from "@/lib/api/session";
import { hrefFor } from "@/lib/routes/registry";
import type { Session } from "@/lib/schemas/session";
import type { FirmLookup } from "@/lib/tenancy/firm-outcome";
import { signInAs } from "@/mocks/sign-in-as";
import { firms } from "@/mocks/team";
import { firmGate, platformGate } from "./gate";

/**
 * What the layouts do on the server (docs/07 Phase D items 2–4), for every kind of principal: the
 * fixture accounts signed in on the mock backend, each firm's slug resolved the way the layout does.
 */

const ONE = firms.find((firm) => firm.status === "ACTIVE")!;
const OTHER = firms.find((firm) => firm.status === "ACTIVE" && firm.id !== ONE.id)!;
const dashboard = (slug: string) => hrefFor("dashboard", { firm: slug });
const analytics = (slug: string) => hrefFor("analytics", { firm: slug });

async function lookup(slug: string): Promise<FirmLookup> {
  try {
    return { status: "success", firm: await sessionApi.firmBySlug(slug) };
  } catch (error) {
    return { status: "error", error: error as Error };
  }
}

async function sessionFor(userId: string): Promise<Session> {
  return signInAs(userId);
}

afterEach(async () => {
  await sessionApi.signOut();
});

describe("firmGate", () => {
  it("signed out: sign-in, whatever the slug", async () => {
    expect(firmGate(null, { status: "pending" }, dashboard(ONE.slug))).toEqual({ kind: "sign-in" });
  });

  it("an unknown slug is not-found for a firm user and for a platform admin", async () => {
    const owner = await sessionFor("user_imran");
    expect(firmGate(owner, await lookup("no-such-firm"), dashboard("no-such-firm"))).toEqual({ kind: "not-found" });
    const admin = await sessionFor("padm_sana");
    expect(firmGate(admin, await lookup("no-such-firm"), dashboard("no-such-firm"))).toEqual({ kind: "not-found" });
  });

  it("another firm's slug is not-found, the same answer as an unknown one", async () => {
    const owner = await sessionFor("user_imran");
    expect("user" in owner && owner.firm.id).toBe(ONE.id);
    expect(firmGate(owner, await lookup(OTHER.slug), dashboard(OTHER.slug))).toEqual({ kind: "not-found" });
  });

  it("a member opens their own firm's pages", async () => {
    const owner = await sessionFor("user_imran");
    expect(firmGate(owner, await lookup(ONE.slug), dashboard(ONE.slug))).toEqual({ kind: "ok" });
  });

  it("a page the role can't open is a 403; a page it can is ok", async () => {
    const viewer = await sessionFor("user_rohan");
    const lookedUp = await lookup(ONE.slug);
    expect(firmGate(viewer, lookedUp, hrefFor("focus", { firm: ONE.slug }))).toEqual({ kind: "forbidden" });
    expect(firmGate(viewer, lookedUp, dashboard(ONE.slug))).toEqual({ kind: "ok" });
  });

  it("a registered firm path is judged by its route, query string and all", async () => {
    const owner = await sessionFor("user_imran");
    const lookedUp = await lookup(ONE.slug);
    expect(firmGate(owner, lookedUp, `${analytics(ONE.slug)}?range=7d`)).toEqual({ kind: "ok" });
  });

  it("a path the registry doesn't know is not-found", async () => {
    expect(firmGate(await sessionFor("user_imran"), await lookup(ONE.slug), `/${ONE.slug}/no-such-page`)).toEqual({ kind: "not-found" });
  });

  it("a platform admin without a support view gets the interstitial in place (200), not a 403", async () => {
    expect(firmGate(await sessionFor("padm_sana"), await lookup(ONE.slug), dashboard(ONE.slug))).toEqual({ kind: "ok" });
  });

  it("a suspended firm is answered in place (200)", async () => {
    const suspended = firms.find((firm) => firm.status === "SUSPENDED")!;
    const member = await sessionFor("user_naveen");
    expect(firmGate(member, { status: "success", firm: suspended }, dashboard(suspended.slug))).toEqual({ kind: "ok" });
  });

  it("a backend error is answered in place (200), never a 404 that hides it", async () => {
    const error: FirmLookup = { status: "error", error: new ApiError("down", "NETWORK", 0) };
    expect(firmGate(await sessionFor("user_imran"), error, dashboard(ONE.slug))).toEqual({ kind: "ok" });
  });

  it("without a path (no header) it decides on the firm alone", async () => {
    expect(firmGate(await sessionFor("user_rohan"), await lookup(ONE.slug), null)).toEqual({ kind: "ok" });
  });
});

describe("platformGate", () => {
  const firms_ = hrefFor("admin.firms");

  it("signed out: sign-in", () => {
    expect(platformGate(null, firms_)).toEqual({ kind: "sign-in" });
  });

  it("a platform admin opens /admin pages, dynamic ones and a query string included", async () => {
    const admin = await sessionFor("padm_sana");
    expect(platformGate(admin, firms_)).toEqual({ kind: "ok" });
    expect(platformGate(admin, `${hrefFor("admin.firms.detail", { firmId: ONE.id })}?tab=users`)).toEqual({ kind: "ok" });
    expect(platformGate(admin, null)).toEqual({ kind: "ok" });
  });

  it("an /admin URL with no page is not-found, even for an admin", async () => {
    expect(platformGate(await sessionFor("padm_sana"), "/admin/no-such-page")).toEqual({ kind: "not-found" });
  });

  it("every firm role gets not-found at /admin, never forbidden", async () => {
    for (const userId of ["user_imran", "user_fatima", "user_adnan", "user_rohan"]) {
      expect(platformGate(await sessionFor(userId), firms_), userId).toEqual({ kind: "not-found" });
    }
  });
});
