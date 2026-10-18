import { describe, expect, it } from "vitest";
import { allCandidates } from "@/mocks/candidates";
import { allUsers, firms } from "@/mocks/team";
import { FIXTURE_NOW, invitesAt } from "@/mocks/tenancy";
import type { Candidate } from "@/lib/schemas/candidate";
import type { User } from "@/lib/schemas/session";
import type { Invite } from "@/lib/schemas/tenancy";
import { deriveFirmUsage, effectiveInviteStatus, isActiveCandidate } from "./tenancy";

/** Tests use a fixed clock: the instant the fixture invite dates were written against. */
const NOW = FIXTURE_NOW;
const invites = invitesAt(NOW);
const usageOf = (firmId: string) => {
  const firm = firms.find((item) => item.id === firmId)!;
  return deriveFirmUsage(firm, { users: allUsers, invites, candidates: allCandidates }, NOW);
};

describe("deriveFirmUsage on the fixture firms (A1–A4)", () => {
  it("firm A (ACTIVE, Growth): 5 users + 1 pending invite; the expired invite frees its seat", () => {
    expect(usageOf("firm_hts")).toMatchObject({ seatsUsed: 6, seatLimit: 10, activeCandidates: 21, candidateLimit: 100, canAddSeat: true, canAddCandidate: true, isOverLimit: false });
  });

  it("second firm (ACTIVE, Starter): exactly at the seat limit, so it can't add a seat but is not over", () => {
    expect(usageOf("firm_stl")).toMatchObject({ seatsUsed: 4, seatLimit: 4, canAddSeat: false, isOverSeatLimit: false, activeCandidates: 3, canAddCandidate: true });
  });

  it("suspended firm, downgraded to Starter: 4 users + 1 pending invite = 5 of 4 seats, so it is over the limit", () => {
    expect(usageOf("firm_cbw")).toMatchObject({ seatsUsed: 5, seatLimit: 4, canAddSeat: false, isOverSeatLimit: true, isOverLimit: true, activeCandidates: 1, canAddCandidate: true, isOverCandidateLimit: false });
  });

  it("onboarding firm: no users, the owner's pending invite reserves one seat", () => {
    expect(usageOf("firm_gsc")).toMatchObject({ seatsUsed: 1, activeCandidates: 0, canAddSeat: true, isOverLimit: false });
  });
});

describe("deriveFirmUsage edges", () => {
  const firm = (seatLimit: number, candidateLimit: number) => ({ id: "f", seatLimit, candidateLimit });
  const user = (id: string, isActive = true) => ({ id, firmId: "f", isActive }) as User;
  const candidate = (status: Candidate["status"]) => ({ firmId: "f", status }) as Candidate;

  it("separates 'can add' (usage < limit) from 'over' (usage > limit)", () => {
    const below = deriveFirmUsage(firm(3, 10), { users: [user("a"), user("b")], invites: [], candidates: [] }, NOW);
    const atLimit = deriveFirmUsage(firm(2, 10), { users: [user("a"), user("b")], invites: [], candidates: [] }, NOW);
    const over = deriveFirmUsage(firm(1, 10), { users: [user("a"), user("b")], invites: [], candidates: [] }, NOW);
    expect([below.canAddSeat, below.isOverSeatLimit]).toEqual([true, false]);
    expect([atLimit.canAddSeat, atLimit.isOverSeatLimit]).toEqual([false, false]);
    expect([over.canAddSeat, over.isOverSeatLimit, over.isOverLimit]).toEqual([false, true, true]);
  });

  it("counts every active role, skips inactive users, and ignores other firms", () => {
    const usage = deriveFirmUsage(firm(10, 10), { users: [user("a"), user("b", false), { ...user("c"), firmId: "other" }], invites: [], candidates: [] }, NOW);
    expect(usage.seatsUsed).toBe(1);
  });

  it("counts only ON_BENCH, INTERVIEWING and OFFER candidates (A2)", () => {
    const statuses: Candidate["status"][] = ["ON_BENCH", "INTERVIEWING", "OFFER", "PLACED", "PAUSED", "INACTIVE"];
    expect(statuses.filter((status) => isActiveCandidate({ status }))).toEqual(["ON_BENCH", "INTERVIEWING", "OFFER"]);
    const usage = deriveFirmUsage(firm(10, 3), { users: [], invites: [], candidates: statuses.map(candidate) }, NOW);
    expect([usage.activeCandidates, usage.canAddCandidate, usage.isOverCandidateLimit]).toEqual([3, false, false]);
  });

  it("treats a PENDING invite past expiresAt as EXPIRED, and only PENDING ones reserve seats (A9)", () => {
    const invite = (status: Invite["status"], expiresAt: string) => ({ status, expiresAt });
    expect(effectiveInviteStatus(invite("PENDING", "2026-10-19T00:00:00.000Z"), NOW)).toBe("PENDING");
    expect(effectiveInviteStatus(invite("PENDING", "2026-10-18T12:00:00.000Z"), NOW)).toBe("EXPIRED");
    expect(effectiveInviteStatus(invite("ACCEPTED", "2026-01-01T00:00:00.000Z"), NOW)).toBe("ACCEPTED");
    const seats = (status: Invite["status"], expiresAt: string) =>
      deriveFirmUsage(firm(10, 10), { users: [], invites: [{ ...invite(status, expiresAt), firmId: "f" } as Invite], candidates: [] }, NOW).seatsUsed;
    expect(seats("PENDING", "2026-10-25T00:00:00.000Z")).toBe(1);
    expect(seats("PENDING", "2026-10-01T00:00:00.000Z")).toBe(0);
    expect(seats("REVOKED", "2026-10-25T00:00:00.000Z")).toBe(0);
    expect(seats("ACCEPTED", "2026-10-25T00:00:00.000Z")).toBe(0);
  });
});

describe("fixture invite dates are relative to load time (no drift in the live UI)", () => {
  it.each([0, 3, 30, 365])("%i days after the fixtures were written, the same invites are pending and expired, and the seat counts don't move", (days) => {
    const later = new Date(FIXTURE_NOW.getTime() + days * 86_400_000);
    const rebased = invitesAt(later);
    const pendingIds = rebased.filter((invite) => effectiveInviteStatus(invite, later) === "PENDING").map((invite) => invite.id);
    expect(pendingIds).toEqual(["inv_hts_01", "inv_stl_01", "inv_cbw_01", "inv_gsc_owner", "inv_platform_01"]);
    expect(effectiveInviteStatus(rebased.find((invite) => invite.id === "inv_hts_02")!, later)).toBe("EXPIRED");
    const stl = firms.find((item) => item.id === "firm_stl")!;
    expect(deriveFirmUsage(stl, { users: allUsers, invites: rebased, candidates: allCandidates }, later)).toMatchObject({ seatsUsed: 4, seatLimit: 4, canAddSeat: false, isOverSeatLimit: false });
  });

  it("keeps each invite's 7-day lifetime when shifting", () => {
    for (const invite of invitesAt(new Date("2030-01-01T00:00:00.000Z"))) {
      const days = (new Date(invite.expiresAt).getTime() - new Date(invite.createdAt).getTime()) / 86_400_000;
      expect(days, invite.id).toBe(7);
    }
  });
});
