import type { ResumeBase, ResumeListing, ResumeVersion } from "../api";

/** The résumés Autofill can answer from: what the picker in the Resume section offers, and which one it starts on. */

/** `title`: the version's headline, which names its file on a form (07 Q52) and heads its row in the picker. `meta`: which
 * base it is, or was tailored from, and its version, the row's second line; the picker tags a tailored one Tailored, as
 * the website does. `baseId`: that base. */
export type ResumeChoice = {
  id: string; label: string; meta: string; isTailored: boolean; isActive: boolean; title: string | null; baseId: string;
  /** Tailored for another job: offered only as the résumé this application was sent with. */
  isOtherJob?: boolean;
};

const newest = (versions: ResumeVersion[]) =>
  versions.reduce<ResumeVersion | null>((latest, version) => (!latest || version.version > latest.version ? version : latest), null);

/** The newest made first: by when it was made, else by its number. */
const newerFirst = (left: ResumeVersion, right: ResumeVersion) =>
  (right.created_at ?? "").localeCompare(left.created_at ?? "") || right.version - left.version;

/** Every résumé tailored for this job, newest first (each Tailor again makes another), and never another job's; then
 * every base the candidate keeps, each at its newest version. The base the workflow uses is `isActive`, which the picker
 * tags Active, as the website does. A hidden base isn't offered, as on the website. An older version of a base the
 * application names (`namedId`) is offered too, after its newest, so the picker can start on it: the application's own
 * résumé, not another one's answers. */
export function resumeChoices(listing: ResumeListing, jobId: string | null, namedId: string | null = null): ResumeChoice[] {
  const numbers = new Map(listing.bases.map(({ id, number }) => [id, number]));
  const tailored = (jobId ? listing.tailored.filter((shelf) => shelf.job_id === jobId) : [])
    .flatMap((shelf) => shelf.versions.map((version) => ({ version, baseId: shelf.base_resume_id })))
    .sort((left, right) => newerFirst(left.version, right.version))
    .map(({ version, baseId }) => {
      const base = numbers.get(baseId);
      return {
        id: version.id, label: `Tailored for this job${base ? ` · from Base ${base}` : ""} · v${version.version}`,
        meta: `${base ? `From Base ${base} · ` : ""}v${version.version}`, isTailored: true, isActive: false,
        title: version.title?.trim() || null, baseId,
      };
    });
  // A base's newest version, then the one the application names when that's an older one.
  const offered = (versions: ResumeVersion[]) => {
    const latest = newest(versions);
    const named = versions.find(({ id }) => id === namedId);
    return !latest ? [] : named && named !== latest ? [latest, named] : [latest];
  };
  const bases = listing.bases.filter(({ archived_at }) => !archived_at).flatMap((base) => offered(base.versions).map((version, index) => {
    const title = version.title?.trim();
    const label = `Base ${base.number}${title ? ` · ${title}` : ""} · v${version.version}`;
    // Active is the base in use at its newest version: an older one of it isn't tagged too.
    return { id: version.id, label, meta: `Base ${base.number} · v${version.version}`, isTailored: false, isActive: base.is_active && index === 0, title: title || null, baseId: base.id };
  }));
  // A hidden base stays out of the general picker. Keep its exact version available only when this application names it.
  const namedHidden = listing.bases.flatMap((base) => {
    if (!base.archived_at) return [];
    const version = base.versions.find(({ id }) => id === namedId);
    if (!version) return [];
    const title = version.title?.trim();
    const meta = `Base ${base.number} · hidden · v${version.version}`;
    return [{ id: version.id, label: meta, meta, isTailored: false, isActive: false, title: title || null, baseId: base.id }];
  });
  // The résumé this application was sent with, when it was tailored for another job: offered for it alone, so the picker
  // starts on it instead of calling it missing (PR #140's review). Another job's tailoring is never offered otherwise.
  const namedOtherJob = listing.tailored.filter((shelf) => shelf.job_id !== jobId).flatMap((shelf) => {
    const version = shelf.versions.find(({ id }) => id === namedId);
    if (!version) return [];
    const base = numbers.get(shelf.base_resume_id);
    const from = `${base ? ` · from Base ${base}` : ""} · v${version.version}`;
    return [{ id: version.id, label: `Tailored for another job${from}`, meta: `For another job${from}`, isTailored: true,
      isActive: false, title: version.title?.trim() || null, baseId: shelf.base_resume_id, isOtherJob: true }];
  });
  return [...tailored, ...bases, ...namedHidden, ...namedOtherJob];
}

/** Where the picker starts: the résumé the application names (sent with it, or tailored for its job) when it's on
 * offer, else this job's newest tailored résumé, else the base the workflow uses, else the first. */
export function defaultResume(choices: ResumeChoice[], namedId: string | null): string | null {
  if (namedId && choices.some(({ id }) => id === namedId)) return namedId;
  return (choices.find(({ isTailored }) => isTailored) ?? choices.find(({ isActive }) => isActive) ?? choices[0])?.id ?? null;
}

/** What Tailor reads: `resumeId`, a base's version 1, the base itself, as the website's Tailor does by default, so a
 * tailoring never makes another base (a later version would, docs/team/tailoring.md). `label` names the base as the list
 * does. */
export type TailorSource = { resumeId: string; baseId: string; label: string };

/** The base of the résumé in use (a tailored one's too: Tailor again), else the active base; never a hidden one. Null
 * when the candidate has no base to tailor from. */
export function tailorSource(listing: ResumeListing, picked: ResumeChoice | null): TailorSource | null {
  const firstOf = (base: ResumeBase | undefined) => (base && !base.archived_at ? base.versions.find(({ version }) => version === 1) : undefined);
  const base = [listing.bases.find(({ id }) => id === picked?.baseId), listing.bases.find(({ is_active }) => is_active)]
    .find((one) => firstOf(one));
  const first = firstOf(base);
  return base && first ? { resumeId: first.id, baseId: base.id, label: `Base ${base.number}${base.is_active ? " (Active)" : ""}` } : null;
}
