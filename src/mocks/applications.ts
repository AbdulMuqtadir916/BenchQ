import { arrayOf } from "@/lib/api/client";
import { ApplicationSchema, FollowUpTaskSchema, type Application, type FollowUpTask } from "@/lib/schemas/application";
import { UpdateApplicationStatusSchema, type UpdateApplicationStatus } from "@/lib/schemas/inbox";
import applicationsSeed from "./data/applications.json";
import followupsSeed from "./data/followups.json";
import { currentUser } from "./auth";
import { findInFirm, inFirm, mockResult } from "./_shared";

export const allApplications: Application[] = arrayOf(ApplicationSchema).parse(applicationsSeed);
export const allFollowups: FollowUpTask[] = arrayOf(FollowUpTaskSchema).parse(followupsSeed);

const CLOSED_STATUSES = ["PLACED", "REJECTED", "WITHDRAWN", "EXPIRED"];

export const applicationsMock = {
  list: (firmId: string, params?: { candidateId?: string }): Promise<Application[]> => {
    const applications = inFirm(allApplications, firmId);
    return mockResult(params?.candidateId ? applications.filter((application) => application.candidateId === params.candidateId) : applications);
  },

  byId: (firmId: string, id: string): Promise<Application> => mockResult(findInFirm(allApplications, firmId, id, "Application")),

  // Stand-in for the backend's status-transition rules; delete with this module.
  updateStatus: (firmId: string, id: string, body: UpdateApplicationStatus): Promise<Application> => {
    const application = findInFirm(allApplications, firmId, id, "Application");
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
    return mockResult(ApplicationSchema.parse(application));
  },
};

export const followupsMock = {
  list: (firmId: string, params?: { userId?: string }): Promise<FollowUpTask[]> => {
    const followups = inFirm(allFollowups, firmId);
    return mockResult(params?.userId ? followups.filter((followup) => followup.assignedToUserId === params.userId) : followups);
  },
};
