import { describe, expect, it } from "vitest";
import { allCandidates } from "@/mocks/candidates";
import { allUsers, firms } from "@/mocks/team";
import { FIXTURE_NOW, invitesAt } from "@/mocks/tenancy";
import type { Candidate } from "@/lib/schemas/candidate";
import type { User } from "@/lib/schemas/session";
import type { Invite } from "@/lib/schemas/tenancy";
import { countsTowardLimit, deriveBdeLoad, deriveFirmUsage, effectiveInviteStatus, isWorkingCandidate } from "./tenancy";

/** Tests use a fixed clock: the instant the fixture invite dates were written against. */
const NOW = FIXTURE_NOW;
const invites = invitesAt(NOW);
const usageOf = (firmId: string) => {
  const firm = firms.find((item) => item.id === firmId)!;
  return deriveFirmUsage(firm, { users: allUsers, invites, candidates: allCandidates }, NOW);
};

describe("deriveFirmUsage on the fixture firms (A1–A4)", () => {
  it("firm A (ACTIVE, Growth): 3 BDEs + 1 pending BDE invite (07 Q44); the expired VIEWER invite and the OWNER, MANAGERs and VIEWER take no seat", () => {
    expect(usageOf("firm_hts")).toMatchObject({ seatsUsed: 4, seatLimit: 10, assignedCandidates: 19, candidateLimit: 100, canAddSeat: true, canAssignCandidate: true, isOverLimit: false });
  });

  it("second firm (ACTIVE, Starter): exactly at the seat limit, so it can't add a seat but is not over", () => {
    expect(usageOf("firm_stl")).toMatchObject({ seatsUsed: 4, seatLimit: 4, canAddSeat: false, isOverSeatLimit: false, assignedCandidates: 2, canAssignCandidate: true });
  });

  it("suspended firm, downgraded to Starter: 5 BDEs + 1 pending BDE invite = 6 of 4 seats, so it is over the limit", () => {
    expect(usageOf("firm_cbw")).toMatchObject({ seatsUsed: 6, seatLimit: 4, canAddSeat: false, isOverSeatLimit: true, isOverLimit: true, assignedCandidates: 1, canAssignCandidate: true, isOverCandidateLimit: false });
  });

  it("suspended firm is over its seat limit on active BDEs alone, whatever Phase S decides about its pending invites", () => {
    const cbw = firms.find((item) => item.id === "firm_cbw")!;
    const withoutInvites = deriveFirmUsage(cbw, { users: allUsers, invites: [], candidates: allCandidates }, NOW);
    expect(withoutInvites).toMatchObject({ seatsUsed: 5, seatLimit: 4, isOverSeatLimit: true, isOverLimit: true });
  });

  it("onboarding firm: no users, and the owner's pending invite takes no seat (07 Q44)", () => {
    expect(usageOf("firm_gsc")).toMatchObject({ seatsUsed: 0, assignedCandidates: 0, canAddSeat: true, isOverLimit: false });
  });
});

describe("deriveFirmUsage edges", () => {
  const firm = (seatLimit: number, candidateLimit: number) => ({ id: "f", seatLimit, candidateLimit });
  const user = (id: string, isActive = true, role: User["role"] = "BDE") => ({ id, firmId: "f", isActive, role }) as User;
  const candidate = (status: Candidate["status"]) => ({ firmId: "f", status }) as Candidate;

  it("separates 'can add' (usage < limit) from 'over' (usage > limit)", () => {
    const below = deriveFirmUsage(firm(3, 10), { users: [user("a"), user("b")], invites: [], candidates: [] }, NOW);
    const atLimit = deriveFirmUsage(firm(2, 10), { users: [user("a"), user("b")], invites: [], candidates: [] }, NOW);
    const over = deriveFirmUsage(firm(1, 10), { users: [user("a"), user("b")], invites: [], candidates: [] }, NOW);
    expect([below.canAddSeat, below.isOverSeatLimit]).toEqual([true, false]);
    expect([atLimit.canAddSeat, atLimit.isOverSeatLimit]).toEqual([false, false]);
    expect([over.canAddSeat, over.isOverSeatLimit, over.isOverLimit]).toEqual([false, true, true]);
  });

  it("counts active BDEs only (07 Q44), skips inactive users, and ignores other firms", () => {
    const usage = deriveFirmUsage(firm(10, 10), { users: [user("a"), user("b", false), { ...user("c"), firmId: "other" }], invites: [], candidates: [] }, NOW);
    expect(usage.seatsUsed).toBe(1);
    const others = (["OWNER", "MANAGER", "VIEWER"] as const).map((role) => user(role, true, role));
    expect(deriveFirmUsage(firm(10, 10), { users: others, invites: [], candidates: [] }, NOW).seatsUsed).toBe(0);
  });

  it("counts candidates with a BDE and a working status (07 Q45): a queue and PAUSED don't count", () => {
    const statuses: Candidate["status"][] = ["ON_BENCH", "INTERVIEWING", "OFFER", "PLACED", "PAUSED", "INACTIVE"];
    expect(statuses.filter((status) => isWorkingCandidate({ status }))).toEqual(["ON_BENCH", "INTERVIEWING", "OFFER"]);
    const assigned = statuses.map((status) => ({ ...candidate(status), bdeId: "bde" }));
    const queued = statuses.map((status) => ({ ...candidate(status), bdeId: null }));
    const usage = deriveFirmUsage(firm(10, 3), { users: [], invites: [], candidates: [...assigned, ...queued] }, NOW);
    expect([usage.assignedCandidates, usage.canAssignCandidate, usage.isOverCandidateLimit]).toEqual([3, false, false]);
    expect(countsTowardLimit({ status: "ON_BENCH", bdeId: null })).toBe(false);
    expect(countsTowardLimit({ status: "PAUSED", bdeId: "bde" })).toBe(false);
  });

  it("a BDE's load is their working candidates against the capacity: at it is a warning (07 Q46)", () => {
    const of = (status: Candidate["status"], bdeId: string | null) => ({ status, bdeId });
    const rows = [of("ON_BENCH", "b"), of("OFFER", "b"), of("PLACED", "b"), of("ON_BENCH", "other"), of("ON_BENCH", null)];
    expect(deriveBdeLoad("b", rows, 3)).toEqual({ load: 2, capacity: 3, isAtCapacity: false });
    expect(deriveBdeLoad("b", rows, 2)).toEqual({ load: 2, capacity: 2, isAtCapacity: true });
  });

  it("treats a PENDING invite past expiresAt as EXPIRED, and only PENDING ones reserve seats (A9)", () => {
    const invite = (status: Invite["status"], expiresAt: string, role: Invite["role"] = "BDE") => ({ status, expiresAt, role });
    expect(effectiveInviteStatus(invite("PENDING", "2026-10-19T00:00:00.000Z"), NOW)).toBe("PENDING");
    expect(effectiveInviteStatus(invite("PENDING", "2026-10-18T12:00:00.000Z"), NOW)).toBe("EXPIRED");
    expect(effectiveInviteStatus(invite("ACCEPTED", "2026-01-01T00:00:00.000Z"), NOW)).toBe("ACCEPTED");
    const seats = (status: Invite["status"], expiresAt: string) =>
      deriveFirmUsage(firm(10, 10), { users: [], invites: [{ ...invite(status, expiresAt), firmId: "f" } as Invite], candidates: [] }, NOW).seatsUsed;
    expect(seats("PENDING", "2026-10-25T00:00:00.000Z")).toBe(1);
    expect(seats("PENDING", "2026-10-01T00:00:00.000Z")).toBe(0);
    expect(seats("REVOKED", "2026-10-25T00:00:00.000Z")).toBe(0);
    expect(seats("ACCEPTED", "2026-10-25T00:00:00.000Z")).toBe(0);
    const pendingAs = (role: Invite["role"]) =>
      deriveFirmUsage(firm(10, 10), { users: [], invites: [{ ...invite("PENDING", "2026-10-25T00:00:00.000Z", role), firmId: "f" } as Invite], candidates: [] }, NOW).seatsUsed;
    expect([pendingAs("BDE"), pendingAs("MANAGER"), pendingAs("VIEWER"), pendingAs("OWNER")]).toEqual([1, 0, 0, 0]);
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
