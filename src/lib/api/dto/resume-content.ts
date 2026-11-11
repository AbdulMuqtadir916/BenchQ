import { normalizeProfileLink } from "@/lib/resume-doc/profile-link";
import type { ResumeDocument, RichText } from "@/lib/schemas/resume-document";
import { stripTags } from "@/lib/resume-doc/rich-text";
import type { ResumeVersionDto } from "./resumes";

/**
 * The studio's document → the body of `POST …/resumes/{id}/save` (backend `ContentIn`), laid over `source`: the version
 * as the backend has it now, read again just before saving (Zuhair 2026-11-05, option 1). What the studio doesn't edit
 * (languages, work authorization) is carried over from `source` untouched, so a save never drops it.
 *
 * Ids (resume-versioning.md §3.4): an item or bullet keeps the id it had in `source`; one the studio added has none,
 * and the backend gives it one (it refuses an id the version doesn't have). The backend compares the text, so an item
 * kept as it was keeps its id and a changed one gets a new id there. Text is sent plain: the backend stores no
 * formatting.
 */
export interface SaveBody {
  full_name: string; title: string; city: string; state: string; country: string; email: string; phone: string;
  work_authorization: string; github: string; linkedin: string; summary: string;
  skills: Array<{ id: string | null; category: string; name: string }>;
  experiences: Array<{ id: string | null; job_title: string; company: string; location: string; dates: string; start: string; end: string; current: boolean; bullets: Array<{ id: string | null; text: string }> }>;
  projects: Array<{ id: string | null; name: string; url: string; dates: string; technologies: string; bullets: Array<{ id: string | null; text: string }> }>;
  educations: Array<{ id: string | null; degree: string; institution: string; graduation_date: string; grade: string }>;
  certifications: Array<{ id: string | null; name: string; issuer: string; date: string; detail: string }>;
  awards: Array<{ id: string | null; name: string; issuer: string; date: string; detail: string }>;
  languages: Array<{ id: string; name: string }>;
}

function idsOf(source: ResumeVersionDto): Set<string> {
  const ids = new Set<string>();
  for (const list of [source.skills, source.educations, source.certifications, source.awards, source.languages]) list.forEach((i) => ids.add(i.id));
  for (const e of [...source.experiences, ...source.projects]) {
    ids.add(e.id);
    e.bullets.forEach((b) => ids.add(b.id));
  }
  return ids;
}

export function toBackendContent(doc: ResumeDocument, source: ResumeVersionDto): SaveBody {
  const known = idsOf(source);
  const used = new Set<string>();
  /** The id, if `source` has it and nothing in this save took it already; else none (a new item). */
  const keep = (id: string): string | null => {
    if (!known.has(id) || used.has(id)) return null;
    used.add(id);
    return id;
  };
  const plain = (t: RichText) => stripTags(t.html);
  const bullets = (list: RichText[]) => list.map((b) => ({ id: keep(b.id), text: plain(b) })).filter((b) => b.text);
  const named = <T extends { name: string }>(rows: T[]) => rows.filter((r) => r.name.trim());

  // A skill row is one category with comma-separated skills; each skill keeps its id by category and name.
  const pool = new Map<string, string[]>();
  for (const s of source.skills) pool.set(`${s.category}\u0000${s.name}`, [...(pool.get(`${s.category}\u0000${s.name}`) ?? []), s.id]);
  const skills = doc.skills.flatMap((row) => row.items.split(",").map((n) => n.trim()).filter(Boolean).map((name) => {
    const id = (pool.get(`${row.category}\u0000${name}`) ?? []).find((candidate) => !used.has(candidate));
    return { id: id ? keep(id) : null, category: row.category.trim(), name };
  }));

  return {
    full_name: doc.fullName.trim(), title: doc.title.trim(),
    city: doc.header.city.trim(), state: doc.header.state.trim(), country: doc.header.country.trim(),
    email: doc.header.email.trim(), phone: doc.header.phone.trim(), github: normalizeProfileLink(doc.header.github) ?? doc.header.github.trim(), linkedin: normalizeProfileLink(doc.header.linkedin) ?? doc.header.linkedin.trim(),
    work_authorization: source.work_authorization,
    summary: plain(doc.summary),
    skills,
    experiences: doc.experience.map((e) => ({
      id: keep(e.id), job_title: e.title, company: e.company, location: e.location, dates: e.dates, start: e.start,
      end: e.current ? "" : e.end, current: e.current, bullets: bullets(e.bullets),
    })),
    projects: doc.projects.map((p) => ({ id: keep(p.id), name: p.name, url: p.link, dates: p.dates, technologies: p.technologies, bullets: bullets(p.bullets) })),
    educations: doc.education.map((e) => ({ id: keep(e.id), degree: e.degree, institution: e.school, graduation_date: e.graduationDate, grade: e.grade })),
    certifications: named(doc.certifications).map((c) => ({ id: keep(c.id), name: c.name.trim(), issuer: c.issuer, date: c.date, detail: c.detail })),
    awards: named(doc.awards).map((c) => ({ id: keep(c.id), name: c.name.trim(), issuer: c.issuer, date: c.date, detail: c.detail })),
    languages: source.languages.filter((l) => l.name.trim()).map((l) => ({ id: l.id, name: l.name })),
  };
}

