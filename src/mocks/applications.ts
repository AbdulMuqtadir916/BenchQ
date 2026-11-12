import { arrayOf } from "@/lib/api/client";
import { ApplicationSchema, type Application } from "@/lib/schemas/application";
import { UpdateApplicationStatusSchema, type UpdateApplicationStatus } from "@/lib/schemas/inbox";
import applicationsSeed from "./data/applications.json";
import { scopeApplications } from "@/lib/auth/policy";
import { currentPrincipal, currentUser } from "./auth";
import { candidatesApi } from "@/lib/api/candidates";
import { findInFirm, inFirm, mockResult, notFound } from "./_shared";
import { firmScoped } from "./membership";
import { changed, table } from "./db";

export const allApplications: Application[] = table("applications", ApplicationSchema, () => arrayOf(ApplicationSchema).parse(applicationsSeed));

const CLOSED_STATUSES = ["MOVE_ON", "PLACED", "REJECTED", "WITHDRAWN", "EXPIRED"];

export const applicationsMock = firmScoped("applications", {
  list: (firmId: string, params?: { candidateId?: string }): Promise<Application[]> => {
    const applications = inFirm(allApplications, firmId);
    return mockResult(params?.candidateId ? applications.filter((application) => application.candidateId === params.candidateId) : applications);
  },

  byId: (firmId: string, id: string): Promise<Application> => mockResult(findInFirm(allApplications, firmId, id, "Application")),

  // Stand-in for the backend's status-transition rules; delete with this module.
  updateStatus: async (firmId: string, id: string, body: UpdateApplicationStatus): Promise<Application> => {
    const application = findInFirm(allApplications, firmId, id, "Application");
    // Who may move it is the policy (docs/07 Phase C): `application.move` is checked by firmScoped (a
    // VIEWER or a support view → 403); the record must be in the principal's scope (a BDE, someone
    // else's; a MANAGER, another team's → 404, exactly like a missing one, so the call never confirms it
    // exists, principle 4).
    // The candidates the principal sees come from the backend (no candidates mock, decided 2026-11-11).
    if (scopeApplications(currentPrincipal(), [application], await candidatesApi.list(firmId)).length === 0) notFound("Application", id);
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
      source: "ui",
      revision: application.statusRevision + 1,
      emailId: null,
    });
    application.statusRevision += 1;
    application.status = update.status;
    if (update.status === "APPLIED" && !application.appliedAt) application.appliedAt = now;
    if (update.status === "SCREENING_CALL" && !application.firstResponseAt) application.firstResponseAt = now;
    if (update.status === "INTERVIEW_SCHEDULED" && !application.interviewAt) application.interviewAt = now;
    if (update.status === "OFFER") application.offerAt = now;
    if (CLOSED_STATUSES.includes(update.status)) application.closedAt = now;
    changed("applications");
    return mockResult(ApplicationSchema.parse(application));
  },

  // Stand-in for POST /api/applications (status saved): one Saved draft per candidate and job.
  saveJob: (firmId: string, body: { candidateId: string; jobId: string; title: string; company: string }): Promise<Application> => {
    const existing = inFirm(allApplications, firmId).find((a) => a.candidateId === body.candidateId && a.jobId === body.jobId);
    if (existing) return mockResult(existing);
    const now = new Date().toISOString();
    const application = ApplicationSchema.parse({
      id: `app_saved_${body.candidateId}_${body.jobId}`, firmId, candidateId: body.candidateId, jobId: body.jobId,
      resumeVersionId: null, submittedByUserId: currentUser().id, status: "SAVED", statusRevision: 0, pendingReviewCount: 0,
      companyNameAtApply: body.company, jobTitleAtApply: body.title, appliedAt: null, firstResponseAt: null, interviewAt: null,
      offerAt: null, closedAt: null, expiresAt: null, coverLetterText: null, notes: null, events: [], createdAt: now,
    });
    allApplications.push(application);
    changed("applications");
    return mockResult(application);
  },

  // Stand-in for PATCH {unfavorite: true}: an untouched Saved draft is removed; anything further is kept.
  unsaveJob: (firmId: string, id: string): Promise<void> => {
    const application = findInFirm(allApplications, firmId, id, "Application");
    if (application.status === "SAVED" && application.events.length === 0) {
      allApplications.splice(allApplications.indexOf(application), 1);
      changed("applications");
    }
    return mockResult(undefined);
  },
}, { updateStatus: "application.move", saveJob: "job.apply", unsaveJob: "job.apply" });
