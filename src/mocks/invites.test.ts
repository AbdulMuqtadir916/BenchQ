import { describe, expect, it } from "vitest";
import { sessionApi } from "@/lib/api/session";
import { landingHref } from "@/lib/routes/landing";
import { allLedger } from "./ledger";
import { allUsers, firms } from "./team";
import { invites } from "./tenancy";

/**
 * docs/07 T7: the GSC owner accepts the pending OWNER invite through the dev switcher, lands on
 * /welcome (first run), and finishing it makes the dashboard their landing. Own file: it changes the
 * mock backend's state (a new user, an ACTIVE firm).
 */
describe("GSC owner: accept the invite, first run, finish /welcome", () => {
  it("lists the pending invite as a dev principal of the onboarding firm", async () => {
    const option = (await sessionApi.devPrincipals()).find((item) => item.id === "inv_gsc_owner");
    expect(option).toMatchObject({ kind: "firm", role: "OWNER", firmId: "firm_gsc", firmStatus: "ONBOARDING", available: true });
  });

  it("accepting creates the never-active OWNER, activates the firm, logs INVITE_ACCEPTED, and lands on /welcome", async () => {
    const session = await sessionApi.devSignInAs("inv_gsc_owner");
    expect(session.principal).toEqual({ kind: "firm", userId: "user_gsc_owner", firmId: "firm_gsc", role: "OWNER" });
    if (!("user" in session)) throw new Error("expected a firm session");
    expect(session.user.lastActiveAt).toBeNull();
    expect(firms.find((firm) => firm.id === "firm_gsc")?.status).toBe("ACTIVE");
    expect(invites.find((invite) => invite.id === "inv_gsc_owner")?.status).toBe("ACCEPTED");
    expect(allLedger[0]).toMatchObject({ firmId: "firm_gsc", action: "INVITE_ACCEPTED", actorUserId: "user_gsc_owner" });
    expect(landingHref(session)).toBe("/gachibowli-staffing/welcome");
  });

  it("finishing /welcome sets lastActiveAt, so the landing becomes the dashboard", async () => {
    const session = await sessionApi.finishFirstRun();
    expect(session.user.lastActiveAt).not.toBeNull();
    expect(allUsers.find((user) => user.id === "user_gsc_owner")?.lastActiveAt).toBe(session.user.lastActiveAt);
    expect(landingHref(session)).toBe("/gachibowli-staffing/dashboard");
  });

  it("then lists the new user, not the invite, and the invite can't be accepted twice", async () => {
    const options = await sessionApi.devPrincipals();
    expect(options.some((item) => item.id === "inv_gsc_owner")).toBe(false);
    expect(options.find((item) => item.id === "user_gsc_owner")).toMatchObject({ firmStatus: "ACTIVE", available: true });
    await expect(sessionApi.devSignInAs("inv_gsc_owner")).rejects.toMatchObject({ status: 400 });
  });
});
