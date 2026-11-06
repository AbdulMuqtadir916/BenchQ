import { z } from "zod";
import type { BaseResume, Resume, ResumeShelf, ResumeVersion } from "@/lib/schemas/resume";
import { ResumeShelfSchema } from "@/lib/schemas/resume";
import type { OpenedResume, ResumeDocument } from "@/lib/schemas/resume-document";
import { OpenedResumeSchema } from "@/lib/schemas/resume-document";
import { escapeHtml } from "@/lib/resume-doc/rich-text";
import { fromBackendId } from "./demo-ids";
import { toIso, toIsoOrNull } from "./shared";

/**
 * Résumé versioning (docs/team/resume-versioning.md §5, docs/02 §8.1): the backend's bases and version rows →
 * the frontend's `BaseResume` and `Resume` groups, and one version's columns → the studio's document. A `Resume` is
 * one (base, category, job) group of rows; its versions are the group's rows, oldest first.
 */

const text = z.string().nullable().optional().transform((v) => v ?? "");

const VersionDto = z.object({
  id: z.string(),
  candidate_id: z.string(),
  base_resume_id: z.string(),
  category: z.enum(["BASE", "TAILORED"]),
  job_id: z.string().nullable(),
  version: z.number().int(),
  name: z.string(),
  /** The version's headline (the role it's written for). Older backends don't send it. */
  title: z.string().nullable().optional(),
  template: z.string().nullable(),
  created_by_user_id: z.string().nullable(),
  created_at: z.string(),
});
type VersionDto = z.infer<typeof VersionDto>;

const BaseDto = z.object({
  id: z.string(),
  candidate_id: z.string(),
  number: z.number().int(),
  source: z.enum(["UPLOAD", "PROMOTED", "MANUAL"]),
  is_active: z.boolean(),
  promoted_from_resume_id: z.string().nullable(),
  archived_at: z.string().nullable(),
  created_by_user_id: z.string(),
  created_at: z.string(),
  versions: z.array(VersionDto),
});

const TailoredDto = z.object({
  candidate_id: z.string(),
  base_resume_id: z.string(),
  job_id: z.string(),
  versions: z.array(VersionDto),
});

/** GET …/candidates/{id}/resumes and GET …/resumes (the firm's): the bases with their versions, and the tailored. */
export const ResumeShelfDto = z.object({ bases: z.array(BaseDto), tailored: z.array(TailoredDto) });
export type ResumeShelfDto = z.infer<typeof ResumeShelfDto>;

const Bullet = z.object({ id: z.string(), text });
const bullets = z.array(Bullet).optional().transform((v) => v ?? []);
const Entry = z.object({ id: z.string(), name: text, issuer: text, date: text, detail: text });
const list = <T extends z.ZodTypeAny>(item: T) => z.array(item).nullable().optional().transform((v) => v ?? []);

/** GET …/resumes/{id}: one version with its content (the shape of `resumes`' content columns, §3.3). */
export const ResumeVersionDto = VersionDto.extend({
  full_name: text, title: text, city: text, state: text, country: text, email: text, phone: text,
  work_authorization: text, github: text, linkedin: text, summary: text, summary_id: z.string().nullable().optional(),
  skills: list(z.object({ id: z.string(), category: text, name: text })),
  experiences: list(z.object({ id: z.string(), job_title: text, company: text, location: text, dates: text, start: text, end: text, current: z.boolean().optional(), bullets })),
  projects: list(z.object({ id: z.string(), name: text, url: text, dates: text, technologies: text, bullets })),
  educations: list(z.object({ id: z.string(), degree: text, institution: text, graduation_date: text, grade: text })),
  certifications: list(Entry),
  awards: list(Entry),
  languages: list(z.object({ id: z.string(), name: text })),
});
export type ResumeVersionDto = z.infer<typeof ResumeVersionDto>;

/** The studio's six designs (resume-studio/templates.ts); a version saved before it had one opens in Modern. */
const DEFAULT_TEMPLATE = "template_modern";
const groupId = (baseId: string, jobId: string | null) => (jobId ? `${baseId}~${jobId}` : baseId);

function toVersions(rows: VersionDto[], resumeId: string): ResumeVersion[] {
  const sorted = [...rows].sort((a, b) => a.version - b.version);
  return sorted.map((row, i) => ({
    id: fromBackendId(row.id), resumeId, versionNumber: row.version,
    parentVersionId: i > 0 ? fromBackendId(sorted[i - 1]!.id) : null,
    templateId: row.template ?? DEFAULT_TEMPLATE, includedSectionIds: [], includedBulletIds: [], bulletOverrides: {},
    atsScore: null, atsGrade: null, atsIssues: [], keywordScore: null, keywordsMatched: [], keywordsMissing: [],
    lines: [], tailoring: null, tracer: null, pdfUrl: null, docxUrl: null, renderedAt: null, changeSummary: null,
    createdByUserId: row.created_by_user_id ? fromBackendId(row.created_by_user_id) : "", createdAt: toIso(row.created_at),
  }));
}

function toResume(firmId: string, rows: VersionDto[], baseId: string, jobId: string | null): Resume {
  const id = groupId(fromBackendId(baseId), jobId ? fromBackendId(jobId) : null);
  const versions = toVersions(rows, id);
  const latest = [...rows].sort((a, b) => b.version - a.version)[0];
  return {
    id, firmId, candidateId: fromBackendId(rows[0]?.candidate_id ?? ""), baseResumeId: fromBackendId(baseId),
    // The backend names every row "Base"; the newest version's headline is the role the résumé is named by.
    name: latest?.title?.trim() || latest?.name || "Base", isMaster: !jobId, targetJobId: jobId ? fromBackendId(jobId) : null,
    templateId: latest?.template ?? DEFAULT_TEMPLATE, versions, latestVersionId: versions.at(-1)?.id ?? "",
  };
}

/** The listing → bases and résumé groups. A base with no versions left lists no résumé. */
export function toResumeShelf(dto: ResumeShelfDto, firmId: string): ResumeShelf {
  const bases: BaseResume[] = dto.bases.map((b) => ({
    id: fromBackendId(b.id), firmId, candidateId: fromBackendId(b.candidate_id), source: b.source, isActive: b.is_active,
    createdByUserId: fromBackendId(b.created_by_user_id), createdAt: toIso(b.created_at),
    promotedFromResumeId: b.promoted_from_resume_id ? fromBackendId(b.promoted_from_resume_id) : null,
    archivedAt: toIsoOrNull(b.archived_at),
  }));
  const resumes = [
    ...dto.bases.filter((b) => b.versions.length).map((b) => toResume(firmId, b.versions, b.id, null)),
    ...dto.tailored.filter((t) => t.versions.length).map((t) => toResume(firmId, t.versions, t.base_resume_id, t.job_id)),
  ];
  return ResumeShelfSchema.parse({ bases, resumes });
}

/**
 * One version's columns → the studio's document, field for field (the parser's strict format; `languages` is kept
 * by the save, never shown). Its id is the version's: the studio's URL names the version.
 */
export function toResumeDocument(v: ResumeVersionDto): ResumeDocument {
  const rich = (b: { id: string; text: string }) => ({ id: b.id, html: escapeHtml(b.text) });
  const families = new Map<string, string[]>();
  for (const skill of v.skills) {
    if (!skill.name) continue;
    families.set(skill.category, [...(families.get(skill.category) ?? []), skill.name]);
  }
  return {
    resumeId: fromBackendId(v.id), candidateId: fromBackendId(v.candidate_id), name: v.name, isMaster: v.category === "BASE",
    templateId: v.template ?? DEFAULT_TEMPLATE, fullName: v.full_name, title: v.title,
    header: { city: v.city, state: v.state, country: v.country, email: v.email, phone: v.phone, linkedin: v.linkedin, github: v.github, workAuthorization: v.work_authorization },
    summary: { id: v.summary_id ?? `summary_${v.id}`, html: escapeHtml(v.summary) },
    experience: v.experiences.map((e) => ({
      id: e.id, company: e.company, title: e.job_title, location: e.location, dates: e.dates, start: e.start, end: e.end,
      current: e.current ?? false, bullets: e.bullets.map(rich),
    })),
    // A skill row is one category: its skills in order, comma-separated (the parser's `technical_skills`).
    skills: [...families].map(([category, items], i) => ({ id: `skills_${i}`, category, items: items.join(", ") })),
    education: v.educations.map((e) => ({ id: e.id, school: e.institution, degree: e.degree, graduationDate: e.graduation_date, grade: e.grade })),
    certifications: v.certifications.map((c) => ({ id: c.id, name: c.name, issuer: c.issuer, date: c.date, detail: c.detail })),
    awards: v.awards.map((c) => ({ id: c.id, name: c.name, issuer: c.issuer, date: c.date, detail: c.detail })),
    projects: v.projects.map((p) => ({ id: p.id, name: p.name, link: p.url, dates: p.dates, technologies: p.technologies, bullets: p.bullets.map(rich) })),
  };
}

/** The opened version, with the résumé group it belongs to (from the candidate's listing, for its history). */
export function toOpenedResume(version: ResumeVersionDto, shelf: ResumeShelf): OpenedResume {
  const versionId = fromBackendId(version.id);
  const resume = shelf.resumes.find((r) => r.versions.some((v) => v.id === versionId));
  if (!resume) throw new Error(`Résumé version ${version.id} is not in its candidate's listing.`);
  return OpenedResumeSchema.parse({ resume, versionId, document: toResumeDocument(version) });
}
