import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { sessionApi } from "@/lib/api/session";
import type { Firm } from "@/lib/schemas/session";
import type { FirmPrincipal, Principal } from "@/lib/schemas/tenancy";
import { allUsers, firms } from "@/mocks/team";
import { firmOutcome, type FirmLookup } from "./firm-outcome";
import { signInAs } from "@/mocks/sign-in-as";

/**
 * docs/07 §2.5 for every fixture principal: sign the mock backend in, resolve each firm's slug (and
 * an unknown one) the way the firm layout does, and check what renders.
 */

const UNKNOWN_SLUG = "no-such-firm";
const slugs = [...firms.map((firm) => firm.slug), UNKNOWN_SLUG];

async function lookup(slug: string): Promise<FirmLookup> {
  try {
    return { status: "success", firm: await sessionApi.firmBySlug(slug) };
  } catch (error) {
    return { status: "error", error: error as Error };
  }
}

async function outcomesFor(principal: Principal | null): Promise<Record<string, string>> {
  const row: Record<string, string> = {};
  for (const slug of slugs) row[slug] = firmOutcome(principal, await lookup(slug)).kind;
  return row;
}

afterEach(async () => {
  await sessionApi.signOut();
});

describe("firm layout outcomes (docs/07 §2.5), every fixture principal × every firm slug", () => {
  const signedInUsers = allUsers.filter((user) => user.isActive);

  it.each(signedInUsers.map((user) => [user.id, user.role, user.firmId] as const))("%s (%s of %s): own firm opens (or is suspended); every other slug is not-found", async (userId, _role, firmId) => {
    const { principal } = await signInAs(userId);
    const own = firms.find((firm) => firm.id === firmId)!;
    const expected = Object.fromEntries(slugs.map((slug) => [slug, slug === own.slug ? (own.status === "SUSPENDED" ? "suspended" : "open") : "not-found"]));
    expect(await outcomesFor(principal)).toEqual(expected);
  });

  it("platform admin without a support view: every existing firm is the support interstitial (§2.5 row 4); an unknown slug is not-found (row 2 comes first)", async () => {
    const { principal } = await signInAs("padm_sana");
    expect(principal.kind).toBe("platform");
    const expected = Object.fromEntries(slugs.map((slug) => [slug, slug === UNKNOWN_SLUG ? "not-found" : "support-required"]));
    expect(await outcomesFor(principal)).toEqual(expected);
    // The lookup answers an admin for any existing firm (they manage them all), but its data stays closed: support view is P4.
    expect((await sessionApi.firmBySlug(firms[0]!.slug)).id).toBe(firms[0]!.id);
    await expect(sessionApi.firmBySlug(UNKNOWN_SLUG)).rejects.toMatchObject({ status: 404 });
  });

  it("covers a user of every firm that has users, including the suspended one", () => {
    expect(new Set(signedInUsers.map((user) => user.firmId))).toEqual(new Set(["firm_hts", "firm_stl", "firm_cbw"]));
  });

  it("signed out: every slug, known or not, goes to sign-in (and the backend answers 401, not 404)", async () => {
    await sessionApi.signOut();
    expect(Object.values(await outcomesFor(null))).toEqual(slugs.map(() => "signed-out"));
    await expect(sessionApi.firmBySlug(firms[0]!.slug)).rejects.toMatchObject({ status: 401 });
  });

  it("answers an unknown slug and another firm's slug with the same 404, so a URL never confirms a firm exists", async () => {
    await signInAs("user_adnan");
    const otherFirm = firms.find((firm) => firm.id === "firm_stl")!.slug;
    expect(firms.some((firm) => firm.slug === UNKNOWN_SLUG)).toBe(false);
    const errors = await Promise.all([UNKNOWN_SLUG, otherFirm].map((slug) => sessionApi.firmBySlug(slug).catch((error: ApiError) => [error.status, error.code, error.message])));
    expect(errors[0]).toEqual(errors[1]);
    expect(errors[0]).toEqual([404, "NOT_FOUND", "Not found."]);
  });
});

describe("firmOutcome edges", () => {
  const principal: FirmPrincipal = { kind: "firm", userId: "u", firmId: "firm_a", role: "BDE" };
  const firm = (overrides: Partial<Firm>) => ({ ...firms.find((item) => item.id === "firm_hts")!, id: "firm_a", ...overrides }) as Firm;

  it("waits while the slug resolves, and shows the error state for anything but a 404", () => {
    expect(firmOutcome(principal, { status: "pending" }).kind).toBe("resolving");
    expect(firmOutcome(principal, { status: "error", error: new ApiError("down", "NETWORK", 503) }).kind).toBe("error");
    expect(firmOutcome(principal, { status: "error", error: new ApiError("nope", "NOT_FOUND", 404) }).kind).toBe("not-found");
  });

  it("checks membership itself too: a firm the backend returned that isn't the principal's is not-found", () => {
    expect(firmOutcome(principal, { status: "success", firm: firm({ id: "firm_b" }) }).kind).toBe("not-found");
    expect(firmOutcome(principal, { status: "success", firm: firm({ id: "firm_b", status: "SUSPENDED" }) }).kind).toBe("not-found");
  });

  it("gives a platform admin not-found for an unknown slug and the interstitial only for a firm that exists", () => {
    const admin = { kind: "platform" as const, userId: "padm", role: "PLATFORM_ADMIN" as const, support: null };
    expect(firmOutcome(admin, { status: "pending" }).kind).toBe("resolving");
    expect(firmOutcome(admin, { status: "error", error: new ApiError("nope", "NOT_FOUND", 404) }).kind).toBe("not-found");
    expect(firmOutcome(admin, { status: "success", firm: firm({}) }).kind).toBe("support-required");
    expect(firmOutcome(admin, { status: "success", firm: firm({ status: "SUSPENDED" }) }).kind).toBe("support-required");
  });

  it("opens the firm, read-only, inside a support view of it — a SUSPENDED firm too; a view of another firm is the interstitial (P4, §2.5)", () => {
    const view = { id: "sv", reason: "Checking a report", startedAt: "2026-10-19T09:00:00.000Z", expiresAt: "2026-10-19T10:00:00.000Z" };
    const supportOf = (firmId: string) => ({ kind: "platform" as const, userId: "padm", role: "PLATFORM_ADMIN" as const, support: { ...view, firmId } });
    const target = firm({});
    expect(firmOutcome(supportOf(target.id), { status: "success", firm: target })).toEqual({ kind: "open", firm: target });
    const suspended = firm({ status: "SUSPENDED" });
    expect(firmOutcome(supportOf(suspended.id), { status: "success", firm: suspended }).kind).toBe("open");
    expect(firmOutcome(supportOf("firm_other"), { status: "success", firm: target }).kind).toBe("support-required");
  });

  it("checks signed-out first and suspended after membership (§2.5 order)", () => {
    expect(firmOutcome(null, { status: "error", error: new ApiError("x", "NOT_FOUND", 404) }).kind).toBe("signed-out");
    expect(firmOutcome(principal, { status: "success", firm: firm({ status: "SUSPENDED" }) }).kind).toBe("suspended");
    expect(firmOutcome(principal, { status: "success", firm: firm({ status: "ACTIVE" }) }).kind).toBe("open");
  });
});

describe("slug → firm resolution (docs/07 T8)", () => {
  it("resolves each firm's exact slug to that firm, for its members", async () => {
    for (const [userId, firmId] of [["user_imran", "firm_hts"], ["user_lakshmi", "firm_stl"], ["user_naveen", "firm_cbw"]] as const) {
      await signInAs(userId);
      const slug = firms.find((firm) => firm.id === firmId)!.slug;
      expect((await sessionApi.firmBySlug(slug)).id).toBe(firmId);
    }
  });

  it.each(["Hyderabad-Tech-Staffing", "hyderabad-tech-staffing-", "hyderabad", " hyderabad-tech-staffing", "hyderabad-tech-staffing/", "firm_hts"])("matches only the exact slug: %j is not-found", async (slug) => {
    await signInAs("user_imran");
    await expect(sessionApi.firmBySlug(slug)).rejects.toMatchObject({ status: 404 });
  });
});
