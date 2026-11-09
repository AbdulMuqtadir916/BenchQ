import { format } from "date-fns";
import type { Candidate } from "@/lib/schemas/candidate";
import type { Record_ } from "@/lib/schemas/record";
import type { Resume, ResumeLine } from "@/lib/schemas/resume";
import type { ResumeDocument, ResumeHeader, RichText } from "@/lib/schemas/resume-document";
import { WORK_AUTH_LABEL } from "@/lib/constants/work-auth";
import { escapeHtml } from "./rich-text";

let seq = 0;
/** Client-side ids for entries the user adds while editing. */
export function newId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq}`;
}

export function newText(html = ""): RichText {
  return { id: newId("text"), html };
}

function fromLine(l: ResumeLine): RichText {
  return { id: l.id, html: escapeHtml(l.text) };
}

function monthYear(iso: string | null): string {
  return iso ? format(new Date(iso), "MMM yyyy") : "";
}

function headerFor(candidate: Candidate | undefined): ResumeHeader {
  return {
    city: candidate?.city ?? "", state: candidate?.state ?? "", country: candidate?.country ?? "",
    email: candidate?.email ?? "", phone: candidate?.phone ?? "", linkedin: candidate?.linkedinUrl ?? "", github: "",
    workAuthorization: candidate?.workAuth ? WORK_AUTH_LABEL[candidate.workAuth] : "",
  };
}

const yearMonth = (iso: string | null) => (iso ? format(new Date(iso), "yyyy-MM") : "");
const year = (iso: string | null) => (iso ? format(new Date(iso), "yyyy") : "");

/**
 * Compose the builder document from one version of the resume (its newest when `versionId` is left out) and the
 * candidate's Record. Mocks only: a live version carries its own text (lib/api/dto/resumes.ts).
 */
export function buildResumeDocument(resume: Resume, candidate: Candidate | undefined, record: Record_ | undefined, versionId?: string): ResumeDocument {
  const version = resume.versions.find((v) => v.id === (versionId ?? resume.latestVersionId)) ?? resume.versions[0];
  const lines = version?.lines ?? [];
  const summaryLine = lines.find((l) => l.section === "summary");

  const experience = (record?.experiences ?? [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((exp) => {
      const expLines = lines
        .filter((l) => l.section === "experience" && l.entityId === exp.id)
        .sort((a, b) => (a.bulletIndex ?? 0) - (b.bulletIndex ?? 0));
      const bullets = expLines.length
        ? expLines.map(fromLine)
        : exp.bullets.map((b) => ({ id: b.id, html: escapeHtml(b.text) }));
      return {
        id: exp.id,
        company: exp.company,
        title: exp.title,
        location: exp.location ?? "",
        dates: `${monthYear(exp.startDate)} – ${exp.isCurrent ? "Present" : monthYear(exp.endDate)}`,
        start: yearMonth(exp.startDate),
        end: exp.isCurrent ? "" : yearMonth(exp.endDate),
        current: exp.isCurrent,
        bullets,
      };
    });

  const families = new Map<string, string[]>();
  for (const skill of record?.skills ?? []) {
    const key = skill.family ?? "Core";
    families.set(key, [...(families.get(key) ?? []), skill.name]);
  }

  return {
    resumeId: version?.id ?? resume.id,
    candidateId: resume.candidateId,
    name: resume.name,
    isMaster: resume.isMaster,
    templateId: version?.templateId ?? resume.templateId,
    fullName: candidate?.fullName ?? "",
    title: candidate?.primaryRole ?? record?.headline ?? "",
    header: headerFor(candidate),
    summary: summaryLine ? fromLine(summaryLine) : newText(escapeHtml(record?.summary ?? "")),
    experience,
    skills: [...families].map(([category, items], i) => ({ id: `skills_${i}`, category, items: items.join(", ") })),
    education: (record?.educations ?? []).map((e) => ({
      id: e.id,
      school: e.institution,
      degree: [e.degree, e.field].filter(Boolean).join(", "),
      graduationDate: year(e.endDate),
      grade: "",
    })),
    certifications: (record?.certificates ?? []).map((c) => ({ id: c.id, name: c.name, issuer: c.issuer ?? "", date: year(c.issueDate), detail: "" })),
    awards: [],
    projects: [],
  };
}
