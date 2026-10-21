import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { invitesApi } from "@/lib/api/invites";
import { sessionApi } from "@/lib/api/session";
import { teamApi } from "@/lib/api/team";
import { allLedger } from "./ledger";
import { signInAs } from "./sign-in-as";

/**
 * The firm side of invites (docs/07 Phase M M1, M5; 07 Q38), the rules backend/tests/test_member_invites.py
 * checks on the backend: OWNER only, never an OWNER, the seat block, the link shown once and "copy link" =
 * resend, the owner's own invite left to BenchQ.
 */
const HTS = "firm_hts";

beforeAll(() => {
  process.env.NEXT_PUBLIC_MOCK_DELAY_MS = "0";
});
afterEach(async () => {
  await sessionApi.signOut();
});

describe("the OWNER invites a member", () => {
  it("sends the invite with a working link, holds a seat and logs INVITE_SENT", async () => {
    await signInAs("user_imran");
    const { invite, token } = await teamApi.invite(HTS, { email: " Priya@HTS.test ", role: "BDE", inviteeName: " Priya " });
    expect(invite).toMatchObject({ firmId: HTS, email: "priya@hts.test", inviteeName: "Priya", role: "BDE", status: "PENDING", invitedByUserId: "user_imran" });
    expect((await teamApi.invites(HTS))[0]!.id).toBe(invite.id);
    expect(allLedger[0]).toMatchObject({ action: "INVITE_SENT", actorUserId: "user_imran", firmId: HTS, summary: "Invited Priya (priya@hts.test) as BDE" });
    await sessionApi.signOut();
    expect(await invitesApi.lookup(token)).toMatchObject({ status: "VALID", email: "priya@hts.test", role: "BDE", inviteeName: "Priya" });
  });

  it("never as OWNER", async () => {
    await signInAs("user_imran");
    await expect(teamApi.invite(HTS, { email: "second.owner@hts.test", role: "OWNER" as never, inviteeName: null })).rejects.toMatchObject({ status: 400, message: "Choose Manager, BDE or Viewer." });
  });

  it("one email is one account", async () => {
    await signInAs("user_imran");
    await expect(teamApi.invite(HTS, { email: "adnan@hyderabad-tech-staffing.benchq.test", role: "BDE", inviteeName: null })).rejects.toMatchObject({ status: 409 });
    await expect(teamApi.invite(HTS, { email: "nikhil@hyderabad-tech-staffing.benchq.test", role: "BDE", inviteeName: null })).rejects.toMatchObject({ status: 409 }); // pending
  });

  it("is blocked at the seat limit, with the reason (A4)", async () => {
    await signInAs("user_lakshmi"); // firm_stl: 3 users + 1 pending invite of 4 seats
    await expect(teamApi.invite("firm_stl", { email: "fifth@stl.test", role: "VIEWER", inviteeName: null })).rejects.toMatchObject({
      status: 409, code: "SEAT_LIMIT", message: "Your plan allows 4 seats; 4 are in use.",
    });
  });

  it("a MANAGER sees the invites but can't send one; a BDE sees neither (Q15)", async () => {
    await signInAs("user_fatima");
    expect((await teamApi.invites(HTS)).length).toBeGreaterThan(0);
    await expect(teamApi.invite(HTS, { email: "x@hts.test", role: "BDE", inviteeName: null })).rejects.toMatchObject({ status: 403 });
    await signInAs("user_adnan");
    await expect(teamApi.invites(HTS)).rejects.toMatchObject({ status: 403 });
  });
});

describe("resend and revoke", () => {
  it("resending gives a new link and stops the old one (copy link = resend, 07 Q38)", async () => {
    await signInAs("user_imran");
    const sent = await teamApi.invite(HTS, { email: "resend@hts.test", role: "VIEWER", inviteeName: null });
    const again = await teamApi.resendInvite(HTS, sent.invite.id);
    expect(again.token).not.toBe(sent.token);
    expect(again.invite.id).toBe(sent.invite.id);
    expect(allLedger[0]).toMatchObject({ action: "INVITE_SENT", summary: "Invite resent to resend@hts.test" });
    await sessionApi.signOut();
    expect(await invitesApi.lookup(sent.token)).toEqual({ status: "INVALID" });
    expect((await invitesApi.lookup(again.token)).status).toBe("VALID");
  });

  it("revoking kills the link and frees the email", async () => {
    await signInAs("user_imran");
    const sent = await teamApi.invite(HTS, { email: "revoke@hts.test", role: "BDE", inviteeName: null });
    expect((await teamApi.revokeInvite(HTS, sent.invite.id)).status).toBe("REVOKED");
    expect(allLedger[0]).toMatchObject({ action: "INVITE_REVOKED", summary: "Revoked the invite to revoke@hts.test" });
    await expect(teamApi.revokeInvite(HTS, sent.invite.id)).rejects.toMatchObject({ status: 409 });
    expect((await teamApi.invite(HTS, { email: "revoke@hts.test", role: "BDE", inviteeName: null })).invite.status).toBe("PENDING");
    await sessionApi.signOut();
    expect((await invitesApi.lookup(sent.token)).status).toBe("REVOKED");
  });

  it("the firm's own OWNER invite is BenchQ's to resend or revoke", async () => {
    await signInAs("user_lakshmi");
    await expect(teamApi.resendInvite("firm_stl", "inv_stl_owner")).rejects.toMatchObject({ status: 403, message: "Only BenchQ can resend or revoke the owner's invite." });
  });

  it("another firm's invite is a 404", async () => {
    await signInAs("user_imran");
    await expect(teamApi.revokeInvite(HTS, "inv_stl_01")).rejects.toMatchObject({ status: 404 });
  });
});
