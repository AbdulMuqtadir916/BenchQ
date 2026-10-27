import { z } from "zod";
import { WorkAuth } from "@/lib/schemas/enums";
import { ResumeDraftSchema, type ResumeDraft } from "@/lib/schemas/resume-draft";

/**
 * The résumé parser's answer (Zuhair's "Response Formats For Parser And Tailoring Resume", the parser half;
 * docs/candidate-onboarding/06-backend.md §4) and its mapper to the frontend's `ResumeDraft` (04-wizard-steps.md §5).
 * Strings the résumé didn't have come back empty, so every field defaults to "" or [].
 */
const text = z.string().default("");

const BackendHeaderSchema = z.object({
  name: text,
  title: text,
  location: text,
  email: text,
  phone: text,
  work_authorization: text,
  github: text,
  linkedin: text,
});

const BackendJobSchema = z.object({
  job_title: text,
  company: text,
  location: text,
  dates: text,
  /** "YYYY-MM", or "YYYY" when no month is printed; empty when only one date is printed. */
  start: text,
  /** Same format; empty when the job is ongoing. */
  end: text,
  current: z.boolean().default(false),
  bullets: z.array(z.string()).default([]),
});

export const BackendResumeParseSchema = z.object({
  header: BackendHeaderSchema.prefault({}),
  professional_summary: text,
  technical_skills: z.array(z.object({ category: text, skills: text })).default([]),
  work_experience: z.array(BackendJobSchema).default([]),
  projects: z.array(z.object({ name: text, url: text, dates: text, technologies: text, bullets: z.array(z.string()).default([]) })).default([]),
  education: z.array(z.object({ degree: text, institution: text, graduation_date: text, grade: text })).default([]),
  certifications: z.array(z.string()).default([]),
});
export type BackendResumeParse = z.infer<typeof BackendResumeParseSchema>;

/** POST /api/firms/{firm_id}/candidates/parse-resume (06 §4): nothing is saved; `parse_id` keeps the file for create. */
export const BackendResumeParseResponseSchema = z.object({
  parse_id: z.string(),
  file_name: z.string(),
  parse: BackendResumeParseSchema,
});

const orNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/** Printed work authorization → the enum, first match wins (GC EAD before GC, H4 EAD before H-1B). */
const WORK_AUTH_PATTERNS: readonly [WorkAuth, RegExp][] = [
  ["GC_EAD", /\b(gc|green\s*card)[\s-]*ead\b|\bi-?485\b/i],
  ["H4_EAD", /\bh-?4[\s-]*ead\b/i],
  ["H1B", /\bh-?1-?b\b/i],
  ["OPT", /\b(stem[\s-]*)?opt\b/i],
  ["CPT", /\bcpt\b/i],
  ["GC", /\bgreen\s*card\b|\bpermanent\s+resident\b|\bgc\b|\blpr\b/i],
  ["USC", /\bu\.?s\.?\s*citizen\b|\busc\b|\bcitizen\b/i],
  ["TN", /\btn\b/i],
];

export function matchWorkAuth(printed: string): WorkAuth | null {
  return WORK_AUTH_PATTERNS.find(([, pattern]) => pattern.test(printed))?.[0] ?? null;
}

/** "Irving, TX" → Irving / TX; "Hyderabad, Telangana, India" → Hyderabad / Telangana; one part → the city. */
export function splitLocation(location: string): { city: string | null; state: string | null } {
  const parts = location.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { city: null, state: null };
  if (parts.length === 1) return { city: parts[0]!, state: null };
  return { city: parts[0]!, state: parts[1]! };
}

/** A LinkedIn link as a URL: "linkedin.com/in/x" gains https://; anything that still isn't a URL is dropped. */
export function toLinkedinUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return z.string().url().safeParse(withScheme).success ? withScheme : null;
}

const monthIndex = (value: string): number | null => {
  const match = /^(\d{4})(?:-(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 12 + (match[2] ? Number(match[2]) - 1 : 0);
};

/**
 * Whole years of experience from the work history: the months covered by every job, overlaps counted once, an ongoing
 * job up to `now`, rounded down. A job with no start (one printed date) is skipped. null when nothing can be counted.
 */
export function yearsFromWork(jobs: BackendResumeParse["work_experience"], now: Date): number | null {
  const thisMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const spans = jobs
    .map((job) => {
      const start = monthIndex(job.start);
      const end = job.current ? thisMonth : monthIndex(job.end);
      return start === null || end === null || end < start ? null : ([start, end] as const);
    })
    .filter((span): span is readonly [number, number] => span !== null)
    .sort((a, b) => a[0] - b[0]);
  if (spans.length === 0) return null;
  let months = 0;
  let [from, to] = spans[0]!;
  for (const [start, end] of spans.slice(1)) {
    if (start <= to + 1) to = Math.max(to, end);
    else {
      months += to - from + 1;
      [from, to] = [start, end];
    }
  }
  months += to - from + 1;
  return Math.floor(months / 12);
}

/** Each group's comma-separated skills, trimmed, empties and case-insensitive duplicates dropped; family = the group. */
export function splitSkills(groups: BackendResumeParse["technical_skills"]): ResumeDraft["skills"] {
  const seen = new Set<string>();
  const skills: ResumeDraft["skills"] = [];
  for (const group of groups) {
    for (const raw of group.skills.split(",")) {
      const name = raw.trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      skills.push({ name, family: orNull(group.category) });
    }
  }
  return skills;
}

export function toResumeDraft(dto: z.input<typeof BackendResumeParseResponseSchema>, now = new Date()): ResumeDraft {
  const { parse_id, file_name, parse } = BackendResumeParseResponseSchema.parse(dto);
  const { header } = parse;
  const email = header.email.trim();
  const { city, state } = splitLocation(header.location);
  const workAuth = matchWorkAuth(header.work_authorization);
  return ResumeDraftSchema.parse({
    parseId: parse_id,
    fileName: file_name,
    fullName: orNull(header.name),
    primaryRole: orNull(header.title),
    email: z.string().email().safeParse(email).success ? email : null,
    phone: orNull(header.phone),
    linkedinUrl: toLinkedinUrl(header.linkedin),
    city,
    state,
    yearsExperience: yearsFromWork(parse.work_experience, now),
    workAuth,
    workAuthText: workAuth === null ? orNull(header.work_authorization) : null,
    summary: orNull(parse.professional_summary),
    skills: splitSkills(parse.technical_skills),
  });
}
