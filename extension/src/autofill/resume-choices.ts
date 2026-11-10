import type { ResumeListing, ResumeVersion } from "../api";

/** The résumés Autofill can answer from: what the picker in the Resume section offers, and which one it starts on. */

/** `title`: the version's headline, which names its file on a form (07 Q52) and heads its row in the picker. `meta`: which
 * base or job it is and its version, the row's second line. */
export type ResumeChoice = { id: string; label: string; meta: string; isTailored: boolean; isActive: boolean; title: string | null };

const newest = (versions: ResumeVersion[]) =>
  versions.reduce<ResumeVersion | null>((latest, version) => (!latest || version.version > latest.version ? version : latest), null);

/** This job's tailored résumés first, then every base the candidate keeps, each at its newest version; the base the
 * workflow uses is `isActive`, which the picker tags Active, as the website does. A hidden base isn't offered, as on the
 * website. */
export function resumeChoices(listing: ResumeListing, jobId: string | null): ResumeChoice[] {
  const numbers = new Map(listing.bases.map(({ id, number }) => [id, number]));
  const tailored = (jobId ? listing.tailored.filter((shelf) => shelf.job_id === jobId) : []).flatMap((shelf) => {
    const version = newest(shelf.versions);
    const base = numbers.get(shelf.base_resume_id);
    return version ? [{
      id: version.id, label: `Tailored for this job${base ? ` · from Base ${base}` : ""} · v${version.version}`,
      meta: `Tailored for this job${base ? ` · from Base ${base}` : ""} · v${version.version}`, isTailored: true, isActive: false,
      title: version.title?.trim() || null,
    }] : [];
  });
  const bases = listing.bases.filter(({ archived_at }) => !archived_at).flatMap((base) => {
    const version = newest(base.versions);
    if (!version) return [];
    const title = version.title?.trim();
    const label = `Base ${base.number}${title ? ` · ${title}` : ""} · v${version.version}`;
    return [{ id: version.id, label, meta: `Base ${base.number} · v${version.version}`, isTailored: false, isActive: base.is_active, title: title || null }];
  });
  return [...tailored, ...bases];
}

/** Where the picker starts: the résumé the application names (sent with it, or tailored for its job) when it's on
 * offer, else this job's tailored résumé, else the base the workflow uses, else the first. */
export function defaultResume(choices: ResumeChoice[], namedId: string | null): string | null {
  if (namedId && choices.some(({ id }) => id === namedId)) return namedId;
  return (choices.find(({ isTailored }) => isTailored) ?? choices.find(({ isActive }) => isActive) ?? choices[0])?.id ?? null;
}
