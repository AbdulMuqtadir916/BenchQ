import type { BaseResume, Resume, ResumeShelf, ResumeVersion } from "@/lib/schemas/resume";

/**
 * The résumé tree (docs/04 §4.3 Resumes, §6 Library): per candidate, each base is a folder holding its versions and
 * the copies tailored from it, one per job. Derived from the shelf, never stored. Bases are numbered "Base 1, 2…" in
 * the order they were made, as the backend numbers them (resume-versioning.md §4.3).
 */
export interface TreeVersion {
  id: string;
  number: number;
  createdAt: string;
  createdByUserId: string;
  isLatest: boolean;
}

export interface TreeTailored {
  resume: Resume;
  jobId: string;
  /** Newest first. */
  versions: TreeVersion[];
}

export interface TreeBase {
  base: BaseResume;
  number: number;
  /** The base's own résumé (its versions); null only if every version is gone. */
  resume: Resume | null;
  /** Newest first. */
  versions: TreeVersion[];
  tailored: TreeTailored[];
}

export interface TreeCandidate {
  candidateId: string;
  /** Shown bases, by number. */
  bases: TreeBase[];
  /** Hidden bases (in use, deleted by the BDE): only the assigned BDE sees them, to show them again. */
  hidden: TreeBase[];
}

function versionsOf(resume: Resume): TreeVersion[] {
  return [...resume.versions]
    .sort((a, b) => b.versionNumber - a.versionNumber)
    .map((v: ResumeVersion) => ({ id: v.id, number: v.versionNumber, createdAt: v.createdAt, createdByUserId: v.createdByUserId, isLatest: v.id === resume.latestVersionId }));
}

const byCreated = (a: BaseResume, b: BaseResume) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** A base's number among its candidate's bases ("Base 2"), counted in the order they were made, hidden ones included. */
export function baseNumber(shelf: ResumeShelf, baseId: string): number | null {
  const base = shelf.bases.find((b) => b.id === baseId);
  if (!base) return null;
  return shelf.bases.filter((b) => b.candidateId === base.candidateId).sort(byCreated).findIndex((b) => b.id === baseId) + 1;
}

/** The shelf as a tree, one entry per candidate that has a base, in `candidateOrder` (others after, as found). */
export function buildResumeTree(shelf: ResumeShelf, candidateOrder: readonly string[] = []): TreeCandidate[] {
  const own = new Map<string, Resume>();
  const tailoredOf = new Map<string, TreeTailored[]>();
  for (const resume of shelf.resumes) {
    if (!resume.baseResumeId) continue;
    if (resume.isMaster) own.set(resume.baseResumeId, resume);
    else if (resume.targetJobId) {
      const list = tailoredOf.get(resume.baseResumeId) ?? [];
      list.push({ resume, jobId: resume.targetJobId, versions: versionsOf(resume) });
      tailoredOf.set(resume.baseResumeId, list);
    }
  }

  const byCandidate = new Map<string, TreeCandidate>();
  for (const base of [...shelf.bases].sort(byCreated)) {
    const entry = byCandidate.get(base.candidateId) ?? { candidateId: base.candidateId, bases: [], hidden: [] };
    byCandidate.set(base.candidateId, entry);
    const resume = own.get(base.id) ?? null;
    const node: TreeBase = {
      base, number: entry.bases.length + entry.hidden.length + 1, resume,
      versions: resume ? versionsOf(resume) : [],
      tailored: (tailoredOf.get(base.id) ?? []).sort((a, b) => (b.versions[0]?.createdAt ?? "").localeCompare(a.versions[0]?.createdAt ?? "")),
    };
    (base.archivedAt ? entry.hidden : entry.bases).push(node);
  }

  const rank = new Map(candidateOrder.map((id, i) => [id, i]));
  return [...byCandidate.values()].sort((a, b) => (rank.get(a.candidateId) ?? Infinity) - (rank.get(b.candidateId) ?? Infinity));
}

/** How many versions and tailored copies a base holds, for its folder's summary line. */
export function baseSummary(node: TreeBase): string {
  const v = node.versions.length;
  const t = node.tailored.length;
  return `${v} ${v === 1 ? "version" : "versions"} · ${t} tailored`;
}
