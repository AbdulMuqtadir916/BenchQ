import { ApiError } from "@/lib/api/client";
import type { Resume, ResumeRemoval, ResumeShelf } from "@/lib/schemas/resume";
import type { OpenedResume, ResumeDocument, ResumeSaveResult } from "@/lib/schemas/resume-document";
import type { AutofillChange, AutofillSaveResult, ResumeAutofill } from "@/lib/schemas/resume-autofill";
import { applyMockChange, mockAutofill } from "./resume-autofill";
import { buildResumeDocument } from "@/lib/resume-doc/build";
import { canChangeResume, canManageResume } from "@/lib/auth/policy";
import { inFirm, mockResult, notFound } from "./_shared";
import { currentPrincipal, currentUser } from "./auth";
import { allCandidates } from "./candidates";
import candidatesSeed from "./data/candidates.json";
import { allRecords } from "./records";
import { firmScoped } from "./membership";
import {
  activeBase, addBase, addFirstBase, allResumes, baseNumber, baseRemoval as removalOfBase, baseRow, deleteBaseRows, deletedVersions,
  linesOf, savedDocs, setActive, shelfOf, showBaseRow, versionRemoval as removalOfVersion, visible,
} from "./resume-state";

export { allResumes };

/**
 * Candidates made in this browser persist across a reload (src/mocks/db.ts); the résumé state is in memory and starts
 * from the fixtures. So each of them gets its first base again here (07 Q58), made by their manager (the creator
 * isn't kept on the candidate). Seeded candidates are left as the fixtures have them.
 */
const seeded = new Set(candidatesSeed.map((c) => c.id));
for (const candidate of allCandidates) if (!seeded.has(candidate.id)) addFirstBase(candidate, candidate.managerId);

const forbidden = () => new ApiError("This candidate's BDE changes their résumés; you can view them.", "FORBIDDEN", 403);
const refused = (message: string) => new ApiError(message, "CONFLICT", 409);

function candidateOf(firmId: string, candidateId: string) {
  return inFirm(allCandidates, firmId).find((c) => c.id === candidateId) ?? notFound("Candidate", candidateId);
}
/** Who may (07 Q55): save, use as base and pick, the candidate's BDE (or the OWNER / a MANAGER while it has none). */
function mayChange(firmId: string, candidateId: string) {
  if (!canChangeResume(currentPrincipal(), candidateOf(firmId, candidateId))) throw forbidden();
}
/** Upload, delete, show again: the candidate's BDE only. */
function mayManage(firmId: string, candidateId: string) {
  if (!canManageResume(currentPrincipal(), candidateOf(firmId, candidateId))) throw forbidden();
}

function groupOf(firmId: string, versionId: string): Resume {
  const resume = inFirm(allResumes, firmId).find((r) => r.versions.some((v) => v.id === versionId) && !deletedVersions.has(versionId));
  return resume && visible(resume) ? resume : notFound("Resume version", versionId);
}

function opened(firmId: string, resume: Resume, versionId: string): OpenedResume {
  const candidate = inFirm(allCandidates, firmId).find((c) => c.id === resume.candidateId);
  const record = inFirm(allRecords, firmId).find((r) => r.candidateId === resume.candidateId);
  const document = savedDocs.get(versionId) ?? buildResumeDocument(resume, candidate, record, versionId);
  return { resume: visible(resume)!, versionId, document };
}

/** A copy of `versionId` as the next version of `into` (or its v1), with `doc` as its text. */
function appendVersion(into: Resume, from: Resume, versionId: string, doc: ResumeDocument): string {
  const source = from.versions.find((v) => v.id === versionId)!;
  const number = Math.max(0, ...into.versions.map((v) => v.versionNumber)) + 1;
  const id = `${into.id}_v${number}_${Date.now().toString(36)}`;
  into.versions.push({ ...source, id, resumeId: into.id, versionNumber: number, parentVersionId: into === from ? source.id : null, lines: linesOf(doc, id), changeSummary: null, createdByUserId: currentUser().id, createdAt: new Date().toISOString() });
  into.latestVersionId = id;
  savedDocs.set(id, { ...doc, resumeId: id });
  return id;
}

function newBase(firmId: string, candidateId: string, from: Resume, versionId: string, source: "PROMOTED" | "UPLOAD", doc: ResumeDocument) {
  const baseId = `base_${candidateId}_${Date.now().toString(36)}`;
  addBase({ id: baseId, firmId, candidateId, source, createdAt: new Date().toISOString(), createdByUserId: currentUser().id, promotedFromResumeId: source === "PROMOTED" ? versionId : null });
  const group: Resume = { id: `resume_${baseId}`, firmId, candidateId, baseResumeId: baseId, name: from.name, isMaster: true, targetJobId: null, templateId: from.templateId, versions: [], latestVersionId: "" };
  allResumes.push(group);
  appendVersion(group, from, versionId, { ...doc, isMaster: true });
  setActive(candidateId, baseId);
}

export const resumesMock = firmScoped("resumes", {
  shelf: (firmId: string): Promise<ResumeShelf> => mockResult(shelfOf(inFirm(allResumes, firmId))),

  shelfByCandidate: (firmId: string, candidateId: string): Promise<ResumeShelf> =>
    mockResult(shelfOf(inFirm(allResumes, firmId).filter((resume) => resume.candidateId === candidateId))),

  open: (firmId: string, versionId: string): Promise<OpenedResume> => mockResult(opened(firmId, groupOf(firmId, versionId), versionId)),

  save: (firmId: string, versionId: string, doc: ResumeDocument): Promise<ResumeSaveResult> => {
    const resume = groupOf(firmId, versionId);
    mayChange(firmId, resume.candidateId);
    const latest = visible(resume)!.versions.at(-1)!;
    const id = appendVersion(resume, resume, versionId, doc);
    const number = resume.versions.at(-1)!.versionNumber;
    const notice = latest.id !== versionId ? `v${latest.versionNumber} was saved while you were editing; your v${number} doesn't include those changes.` : null;
    return mockResult({ opened: opened(firmId, resume, id), notice });
  },

  useAsBase: (firmId: string, candidateId: string, versionId: string): Promise<void> => {
    mayChange(firmId, candidateId);
    const resume = groupOf(firmId, versionId);
    const version = resume.versions.find((v) => v.id === versionId)!;
    if (resume.isMaster && version.versionNumber === 1 && resume.baseResumeId) setActive(candidateId, resume.baseResumeId);
    else {
      const promoted = allResumes.find((r) => r.isMaster && r.baseResumeId && baseRow(r.baseResumeId)?.promotedFromResumeId === versionId && !baseRow(r.baseResumeId)?.deleted);
      if (promoted?.baseResumeId) setActive(candidateId, promoted.baseResumeId);
      else newBase(firmId, candidateId, resume, versionId, "PROMOTED", opened(firmId, resume, versionId).document);
    }
    return mockResult(undefined);
  },

  /** No parser on mocks: the upload becomes a new active base holding the active base's newest text. */
  upload: (firmId: string, candidateId: string, fileName: string): Promise<{ restored: boolean; fileName: string }> => {
    mayManage(firmId, candidateId);
    const current = activeBase(candidateId);
    const from = allResumes.find((r) => r.isMaster && r.baseResumeId === current);
    const latest = from && visible(from)?.versions.at(-1);
    if (!from || !latest) throw refused("This candidate has no base to start from.");
    newBase(firmId, candidateId, from, latest.id, "UPLOAD", opened(firmId, from, latest.id).document);
    return mockResult({ restored: false, fileName });
  },

  baseRemoval: (firmId: string, candidateId: string, baseId: string): Promise<ResumeRemoval> => {
    candidateOf(firmId, candidateId);
    if (baseRow(baseId)?.candidateId !== candidateId || baseRow(baseId)?.deleted) notFound("Base", baseId);
    const { outcome, message, uses, rest } = removalOfBase(baseId);
    return mockResult({ outcome, message, uses, rest });
  },

  versionRemoval: (firmId: string, candidateId: string, versionId: string): Promise<ResumeRemoval> => {
    candidateOf(firmId, candidateId);
    return mockResult(removalOfVersion(groupOf(firmId, versionId), versionId));
  },

  deleteBase: (firmId: string, candidateId: string, baseId: string, keepUsed: boolean): Promise<ResumeRemoval> => {
    mayManage(firmId, candidateId);
    if (baseRow(baseId)?.candidateId !== candidateId || baseRow(baseId)?.deleted) notFound("Base", baseId);
    const { plan, ...removal } = removalOfBase(baseId);
    if (removal.outcome === "REFUSED") throw refused(removal.message);
    deleteBaseRows(baseId, removal.outcome, plan, keepUsed);
    return mockResult(removal);
  },

  deleteVersion: (firmId: string, candidateId: string, versionId: string): Promise<ResumeRemoval> => {
    mayManage(firmId, candidateId);
    const removal = removalOfVersion(groupOf(firmId, versionId), versionId);
    if (removal.outcome === "REFUSED") throw refused(removal.message);
    deletedVersions.add(versionId);
    return mockResult(removal);
  },

  showBase: (firmId: string, candidateId: string, baseId: string): Promise<{ number: number }> => {
    mayManage(firmId, candidateId);
    if (baseRow(baseId)?.candidateId !== candidateId || baseRow(baseId)?.deleted) notFound("Base", baseId);
    showBaseRow(baseId);
    return mockResult({ number: baseNumber(baseId) });
  },

  autofill: (firmId: string, versionId: string): Promise<ResumeAutofill> => {
    const resume = groupOf(firmId, versionId);
    const candidate = inFirm(allCandidates, firmId).find((c) => c.id === resume.candidateId);
    const entries = mockAutofill(versionId, opened(firmId, resume, versionId).document, candidate);
    return mockResult({ versionId, candidateId: resume.candidateId, entries });
  },

  saveAutofill: (firmId: string, versionId: string, change: AutofillChange): Promise<AutofillSaveResult> => {
    const resume = groupOf(firmId, versionId);
    mayChange(firmId, resume.candidateId);
    const candidate = inFirm(allCandidates, firmId).find((c) => c.id === resume.candidateId);
    const { document } = opened(firmId, resume, versionId);
    applyMockChange(versionId, document, candidate, change);
    return mockResult({ autofill: { versionId, candidateId: resume.candidateId, entries: mockAutofill(versionId, document, candidate) }, changed: 1 });
  },
}, { save: "resume.edit", useAsBase: "resume.edit", upload: "resume.edit", deleteBase: "resume.edit", deleteVersion: "resume.edit", showBase: "resume.edit", saveAutofill: "resume.edit" });
