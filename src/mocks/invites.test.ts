import { afterAll, describe, expect, it } from "vitest";
import { sessionApi } from "@/lib/api/session";
import { landingHref } from "@/lib/routes/landing";
import { DEMO_PASSWORD } from "./auth";
import { acceptInvite } from "./invites";
import { allLedger } from "./ledger";
import { allUsers, firms } from "./team";
import { invites } from "./tenancy";

/**
 * docs/07 T7: the GSC owner accepts the pending OWNER invite (the mock backend's side of
 * /invite/[token], which arrives in P4, Q26), signs in, lands on /welcome (first run), and finishing it
 * makes the dashboard their landing. Own file: it changes the mock backend's state.
 */
afterAll(async () => {
  await sessionApi.signOut();
});

describe("GSC owner: accept the invite, sign in, first run, finish /welcome", () => {
  it("accepting creates the never-active OWNER, activates the firm and logs INVITE_ACCEPTED", () => {
    const user = acceptInvite("inv_gsc_owner", { userId: "user_gsc_owner", name: "Sunita Rao" });
    expect(user).toMatchObject({ id: "user_gsc_owner", firmId: "firm_gsc", role: "OWNER", email: "owner@gachibowli-staffing.benchq.test", lastActiveAt: null });
    expect(firms.find((firm) => firm.id === "firm_gsc")?.status).toBe("ACTIVE");
    expect(invites.find((invite) => invite.id === "inv_gsc_owner")?.status).toBe("ACCEPTED");
    expect(allLedger[0]).toMatchObject({ firmId: "firm_gsc", action: "INVITE_ACCEPTED", actorUserId: "user_gsc_owner" });
  });

  it("the new OWNER signs in with the invite's email and lands on /welcome", async () => {
    const session = await sessionApi.signIn("owner@gachibowli-staffing.benchq.test", DEMO_PASSWORD);
    if (!("user" in session)) throw new Error("expected a firm session");
    expect(session.principal).toEqual({ kind: "firm", userId: "user_gsc_owner", firmId: "firm_gsc", role: "OWNER" });
    expect(session.user.lastActiveAt).toBeNull();
    expect(landingHref(session)).toBe("/gachibowli-staffing/welcome");
  });

  it("finishing /welcome sets lastActiveAt, so the landing becomes the dashboard", async () => {
    const session = await sessionApi.finishFirstRun();
    expect(session.user.lastActiveAt).not.toBeNull();
    expect(allUsers.find((user) => user.id === "user_gsc_owner")?.lastActiveAt).toBe(session.user.lastActiveAt);
    expect(landingHref(session)).toBe("/gachibowli-staffing/dashboard");
  });

  it("can't be accepted twice", () => {
    expect(() => acceptInvite("inv_gsc_owner", { userId: "user_gsc_owner_2", name: "Someone Else" })).toThrow(/no longer valid/);
  });
});
