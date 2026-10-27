import { arrayOf } from "@/lib/api/client";
import { ApplicationSchema, FollowUpTaskSchema, type Application, type FollowUpTask } from "@/lib/schemas/application";
import { UpdateApplicationStatusSchema, type UpdateApplicationStatus } from "@/lib/schemas/inbox";
import applicationsSeed from "./data/applications.json";
import followupsSeed from "./data/followups.json";
import { scopeApplications } from "@/lib/auth/policy";
import { currentPrincipal, currentUser } from "./auth";
import { allCandidates } from "./candidates";
import { findInFirm, inFirm, mockResult, notFound } from "./_shared";
import { firmScoped } from "./membership";
import { changed, table } from "./db";

export const allApplications: Application[] = table("applications", ApplicationSchema, () => arrayOf(ApplicationSchema).parse(applicationsSeed));
export const allFollowups: FollowUpTask[] = arrayOf(FollowUpTaskSchema).parse(followupsSeed);

const CLOSED_STATUSES = ["PLACED", "REJECTED", "WITHDRAWN", "EXPIRED"];

export const applicationsMock = firmScoped("applications", {
  list: (firmId: string, params?: { candidateId?: string }): Promise<Application[]> => {
    const applications = inFirm(allApplications, firmId);
    return mockResult(params?.candidateId ? applications.filter((application) => application.candidateId === params.candidateId) : applications);
  },

  byId: (firmId: string, id: string): Promise<Application> => mockResult(findInFirm(allApplications, firmId, id, "Application")),

  // Stand-in for the backend's status-transition rules; delete with this module.
  updateStatus: (firmId: string, id: string, body: UpdateApplicationStatus): Promise<Application> => {
    const application = findInFirm(allApplications, firmId, id, "Application");
    // Who may move it is the policy (docs/07 Phase C): `application.move` is checked by firmScoped (a
    // VIEWER or a support view → 403); the record must be in the principal's scope (a BDE, someone
    // else's; a MANAGER, another team's → 404, exactly like a missing one, so the call never confirms it
    // exists, principle 4).
    if (scopeApplications(currentPrincipal(), [application], inFirm(allCandidates, firmId)).length === 0) notFound("Application", id);
    const update = UpdateApplicationStatusSchema.parse(body);
    const now = new Date().toISOString();

    application.events.push({
      id: `evt_${application.id}_${application.events.length}`,
      applicationId: application.id,
      fromStatus: application.status,
      toStatus: update.status,
      note: update.note,
      actorUserId: currentUser().id,
      isAutomated: false,
      createdAt: now,
    });
    application.status = update.status;
    if (update.status === "RESPONSE" && !application.firstResponseAt) application.firstResponseAt = now;
    if (update.status === "INTERVIEW" && !application.interviewAt) application.interviewAt = now;
    if (update.status === "OFFER") application.offerAt = now;
    if (CLOSED_STATUSES.includes(update.status)) application.closedAt = now;
    changed("applications");
    return mockResult(ApplicationSchema.parse(application));
  },
}, { updateStatus: "application.move" });

export const followupsMock = firmScoped("followups", {
  list: (firmId: string, params?: { userId?: string }): Promise<FollowUpTask[]> => {
    const followups = inFirm(allFollowups, firmId);
    return mockResult(params?.userId ? followups.filter((followup) => followup.assignedToUserId === params.userId) : followups);
  },
});
