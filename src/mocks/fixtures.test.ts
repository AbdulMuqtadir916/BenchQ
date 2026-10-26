import { describe, expect, it } from "vitest";
import { isOwner } from "@/lib/auth/roles";
import { allCandidates } from "./candidates";
import { allJobs } from "./jobs";
import { allApplications, allFollowups } from "./applications";
import { allResumes } from "./resumes";
import { allRecords } from "./records";
import { allDocuments } from "./documents";
import { allMessages } from "./inbox";
import { allUsers, firms } from "./team";
import { FIXTURE_NOW, invitesAt, plans, platformUsers } from "./tenancy";

/**
 * Tenancy integrity of the fixtures (docs/07 T3). Every firm-scoped record belongs to a known firm,
 * and nothing points across firms, so Phase T's isolation tests have clean data to work on.
 */

const invites = invitesAt(FIXTURE_NOW);
const firmIds = new Set(firms.map((firm) => firm.id));
const byId = <T extends { id: string }>(rows: readonly T[]) => new Map(rows.map((row) => [row.id, row]));
const candidateById = byId(allCandidates);
const jobById = byId(allJobs());
const applicationById = byId(allApplications);

describe("firms, plans, users and invites", () => {
  it("has the four fixture firms, one per status the app must handle", () => {
    const summary = firms.map((firm) => `${firm.id}:${firm.status}`);
    expect(summary).toEqual(["firm_hts:ACTIVE", "firm_stl:ACTIVE", "firm_cbw:SUSPENDED", "firm_gsc:ONBOARDING"]);
  });

  it("gives every firm a unique valid slug and an existing plan whose limits it copied (A3, A16)", () => {
    expect(new Set(firms.map((firm) => firm.slug)).size).toBe(firms.length);
    const planById = byId(plans);
    for (const firm of firms) {
      const plan = planById.get(firm.planId);
      expect(plan, firm.id).toBeDefined();
      expect([firm.seatLimit, firm.candidateLimit], firm.id).toEqual([plan!.seatLimit, plan!.candidateLimit]);
    }
  });

  it("puts every user in a known firm and gives each firm at most one OWNER, counting pending OWNER invites (A10)", () => {
    for (const user of allUsers) expect(firmIds.has(user.firmId), user.id).toBe(true);
    for (const firm of firms) {
      const owners = allUsers.filter((user) => user.firmId === firm.id && isOwner(user)).length;
      const pendingOwnerInvites = invites.filter((invite) => invite.firmId === firm.id && isOwner(invite) && invite.status === "PENDING").length;
      expect(owners + pendingOwnerInvites, firm.id).toBe(1);
    }
  });

  it("models the onboarding firm as no users plus the owner's pending invite, sent by a Super Admin", () => {
    expect(allUsers.filter((user) => user.firmId === "firm_gsc")).toEqual([]);
    const ownerInvite = invites.find((invite) => invite.firmId === "firm_gsc");
    const platformIds = new Set(platformUsers.map((user) => user.id));
    expect(ownerInvite).toMatchObject({ role: "OWNER", status: "PENDING" });
    expect(platformIds.has(ownerInvite!.invitedByUserId)).toBe(true);
  });

  it("records how each active firm's OWNER joined: an accepted OWNER invite from a Super Admin", () => {
    const platformIds = new Set(platformUsers.map((user) => user.id));
    for (const firmId of ["firm_stl", "firm_cbw"]) {
      const accepted = invites.find((invite) => invite.firmId === firmId && isOwner(invite) && invite.status === "ACCEPTED");
      expect(accepted, firmId).toBeDefined();
      expect(platformIds.has(accepted!.invitedByUserId)).toBe(true);
      const owner = allUsers.find((user) => user.firmId === firmId && isOwner(user));
      expect(accepted!.email).toBe(owner!.email);
    }
  });

  it("only lets firm users invite into their own firm (or a Super Admin anywhere), and never as OWNER", () => {
    const platformIds = new Set(platformUsers.map((user) => user.id));
    for (const invite of invites) {
      if (platformIds.has(invite.invitedByUserId)) continue;
      const inviter = allUsers.find((user) => user.id === invite.invitedByUserId);
      expect(inviter?.firmId, invite.id).toBe(invite.firmId);
      expect(invite.role, invite.id).not.toBe("OWNER");
    }
  });
});

describe("firmId on every firm-scoped record", () => {
  const tables = {
    candidates: allCandidates,
    jobs: allJobs(),
    applications: allApplications,
    followups: allFollowups,
    resumes: allResumes,
    records: allRecords,
    documents: allDocuments,
    inboxMessages: allMessages,
  };

  it.each(Object.entries(tables))("%s: every row belongs to a known firm, and ids are unique", (_name, rows) => {
    for (const row of rows) expect(firmIds.has(row.firmId), row.id).toBe(true);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  it("never points across firms", () => {
    const same = (label: string, a: string | undefined, b: string | undefined) => expect(a, label).toBe(b);
    for (const a of allApplications) {
      same(`${a.id} candidate`, candidateById.get(a.candidateId)?.firmId, a.firmId);
      same(`${a.id} job`, jobById.get(a.jobId)?.firmId, a.firmId);
    }
    for (const f of allFollowups) same(`${f.id} application`, applicationById.get(f.applicationId)?.firmId, f.firmId);
    for (const r of allResumes) {
      same(`${r.id} candidate`, candidateById.get(r.candidateId)?.firmId, r.firmId);
      for (const version of r.versions) if (version.tailoring) same(`${version.id} tailoring`, version.tailoring.firmId, r.firmId);
    }
    for (const r of allRecords) same(`${r.id} candidate`, candidateById.get(r.candidateId)?.firmId, r.firmId);
    for (const d of allDocuments) same(`${d.id} candidate`, candidateById.get(d.candidateId)?.firmId, d.firmId);
    for (const m of allMessages) same(`${m.id} candidate`, candidateById.get(m.candidateId)?.firmId, m.firmId);
    for (const c of allCandidates) {
      for (const userId of c.assignedUserIds) same(`${c.id} assignee ${userId}`, allUsers.find((user) => user.id === userId)?.firmId, c.firmId);
    }
  });
});

describe("principals the dev switcher can offer (docs/07 §3)", () => {
  it("has every firm role in firm A, and users in another firm", () => {
    const rolesA = new Set(allUsers.filter((user) => user.firmId === "firm_hts").map((user) => user.role));
    expect([...rolesA].sort()).toEqual(["BDE", "MANAGER", "OWNER", "VIEWER"]);
    expect(allUsers.some((user) => user.firmId === "firm_stl")).toBe(true);
  });
});
