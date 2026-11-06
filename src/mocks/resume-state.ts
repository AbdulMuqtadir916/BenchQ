import { arrayOf } from "@/lib/api/client";
import { ResumeSchema, type BaseResume, type Resume, type ResumeRemoval, type ResumeShelf } from "@/lib/schemas/resume";
import type { ResumeDocument } from "@/lib/schemas/resume-document";
import { stripTags } from "@/lib/resume-doc/rich-text";
import resumesSeed from "./data/resumes.json";
import { allApplications } from "./applications";

/**
 * The mocks' résumé state (in memory, like the backend's rows): every résumé group with every version ever saved,
 * and what the backend keeps on `base_resumes` (source, active, hidden, deleted). Deleted versions stay in their
 * group, so a version number is never reused (resume-versioning.md §4.7); readers skip them.
 */
export const allResumes: Resume[] = arrayOf(ResumeSchema).parse(resumesSeed);

interface BaseRow { id: string; firmId: string; candidateId: string; source: BaseResume["source"]; createdAt: string; createdByUserId: string; promotedFromResumeId: string | null; archivedAt: string | null; deleted: boolean }

const bases = new Map<string, BaseRow>();
const active = new Map<string, string>();
export const deletedVersions = new Set<string>();
/** A version's text as saved in the studio (the fixtures hold lines and a Record; a save keeps the whole document). */
export const savedDocs = new Map<string, ResumeDocument>();

for (const r of allResumes) {
  if (!r.isMaster || !r.baseResumeId || bases.has(r.baseResumeId)) continue;
  const first = [...r.versions].sort((a, b) => a.versionNumber - b.versionNumber)[0];
  bases.set(r.baseResumeId, { id: r.baseResumeId, firmId: r.firmId, candidateId: r.candidateId, source: "UPLOAD", createdAt: first?.createdAt ?? new Date(0).toISOString(), createdByUserId: first?.createdByUserId ?? "", promotedFromResumeId: null, archivedAt: null, deleted: false });
  if (!active.has(r.candidateId)) active.set(r.candidateId, r.baseResumeId);
}

export const baseRow = (id: string): BaseRow | undefined => bases.get(id);
export const activeBase = (candidateId: string) => active.get(candidateId);
export const setActive = (candidateId: string, baseId: string) => active.set(candidateId, baseId);
export function addBase(row: Omit<BaseRow, "archivedAt" | "deleted">): void {
  bases.set(row.id, { ...row, archivedAt: null, deleted: false });
}

/** A group as readers see it: deleted versions left out (null when none is left or its base is gone). */
export function visible(resume: Resume): Resume | null {
  if (resume.baseResumeId && bases.get(resume.baseResumeId)?.deleted) return null;
  const versions = resume.versions.filter((v) => !deletedVersions.has(v.id));
  if (!versions.length) return null;
  const latest = versions.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a));
  return { ...resume, versions, latestVersionId: latest.id };
}

export function shelfOf(resumes: readonly Resume[]): ResumeShelf {
  const shown = resumes.map(visible).filter((r): r is Resume => r !== null);
  const ids = new Set(resumes.map((r) => r.baseResumeId).filter((id): id is string => !!id));
  const rows = [...ids].map((id) => bases.get(id)).filter((b): b is BaseRow => !!b && !b.deleted);
  return {
    bases: rows.map((b) => ({ id: b.id, firmId: b.firmId, candidateId: b.candidateId, source: b.source, madeByLead: false, isActive: active.get(b.candidateId) === b.id, createdByUserId: b.createdByUserId, createdAt: b.createdAt, promotedFromResumeId: b.promotedFromResumeId, archivedAt: b.archivedAt })),
    resumes: shown,
  };
}

/** "Base 1, 2…" in the order made, deleted ones not counted (§4.3). */
export function baseNumber(baseId: string): number {
  const row = bases.get(baseId);
  if (!row) return 0;
  const mine = [...bases.values()].filter((b) => b.candidateId === row.candidateId && !b.deleted).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return mine.findIndex((b) => b.id === baseId) + 1;
}

/** The plain lines the fixtures keep for a version (summary and job bullets), from a saved document. */
export function linesOf(doc: ResumeDocument, versionId: string) {
  return [
    { id: doc.summary.id, resumeVersionId: versionId, section: "summary" as const, entityId: null, bulletIndex: null, text: stripTags(doc.summary.html) },
    ...doc.experience.flatMap((e) => e.bullets.map((b, i) => ({ id: b.id, resumeVersionId: versionId, section: "experience" as const, entityId: e.id, bulletIndex: i, text: stripTags(b.html) }))),
  ];
}

// ── Removal (resume-versioning.md §4.7): in use = a live application sent with it ──────────────────────────────

const CLOSED = new Set(["REJECTED", "WITHDRAWN", "EXPIRED"]);
const liveUses = (versionIds: Set<string>) => allApplications.filter((a) => a.resumeVersionId && versionIds.has(a.resumeVersionId) && !CLOSED.has(a.status)).length;
const shownVersions = (r: Resume) => r.versions.filter((v) => !deletedVersions.has(v.id));

export function groupsOf(baseId: string) {
  const own = allResumes.find((r) => r.isMaster && r.baseResumeId === baseId);
  const tailored = allResumes.filter((r) => !r.isMaster && r.baseResumeId === baseId && shownVersions(r).length);
  return { own, tailored };
}

export function baseRemoval(baseId: string): ResumeRemoval & { plan: { versions: string[]; tailored: string[] } } {
  const row = bases.get(baseId)!;
  const n = baseNumber(baseId);
  const { own, tailored } = groupsOf(baseId);
  const plan = { versions: [] as string[], tailored: [] as string[] };
  if (active.get(row.candidateId) === baseId) return { outcome: "REFUSED", message: `Base ${n} is the one in use. Pick another base first.`, uses: {}, rest: {}, plan };
  const ownVersions = own ? shownVersions(own) : [];
  const applications = liveUses(new Set(ownVersions.map((v) => v.id)));
  const usedTailored = tailored.filter((t) => liveUses(new Set(shownVersions(t).map((v) => v.id))) > 0);
  if (!applications && !usedTailored.length) return { outcome: "DELETE", message: `Delete Base ${n}? It's removed from view with its versions and tailored copies; the ledger keeps the record.`, uses: {}, rest: {}, plan };
  plan.versions = ownVersions.filter((v) => v.versionNumber > 1 && !liveUses(new Set([v.id]))).map((v) => v.id);
  plan.tailored = tailored.filter((t) => !usedTailored.includes(t)).map((t) => t.id);
  const uses = { applications, tailored: usedTailored.length };
  const words = [applications ? `${applications} live application${applications === 1 ? "" : "s"}` : null, usedTailored.length ? `${usedTailored.length} tailored résumé${usedTailored.length === 1 ? "" : "s"} sent in a live application` : null].filter(Boolean).join(", ");
  return { outcome: "HIDE", message: `Base ${n} is used by ${words}. It will be hidden, not deleted.`, uses, rest: { versions: plan.versions.length, tailored: plan.tailored.length }, plan };
}

export function versionRemoval(resume: Resume, versionId: string): ResumeRemoval {
  const v = resume.versions.find((x) => x.id === versionId)!;
  if (resume.isMaster && v.versionNumber === 1) {
    return { outcome: "REFUSED", message: "A base's v1 is the base. Delete the whole base instead.", uses: {}, rest: {} };
  }
  const sent = liveUses(new Set([versionId]));
  if (sent) return { outcome: "REFUSED", message: `Can't delete v${v.versionNumber}: it was sent to ${sent} job${sent === 1 ? "" : "s"}.`, uses: { applications: sent }, rest: {} };
  return { outcome: "DELETE", message: `Delete v${v.versionNumber}? It's removed from view; the ledger keeps the record.`, uses: {}, rest: {} };
}

export function deleteBaseRows(baseId: string, outcome: ResumeRemoval["outcome"], plan: { versions: string[]; tailored: string[] }, keepUsed: boolean): void {
  const row = bases.get(baseId)!;
  if (outcome === "DELETE") {
    row.deleted = true;
    return;
  }
  row.archivedAt = new Date().toISOString();
  if (!keepUsed) return;
  plan.versions.forEach((id) => deletedVersions.add(id));
  for (const id of plan.tailored) allResumes.find((r) => r.id === id)?.versions.forEach((v) => deletedVersions.add(v.id));
}

export const showBaseRow = (baseId: string) => { const row = bases.get(baseId); if (row) row.archivedAt = null; };
