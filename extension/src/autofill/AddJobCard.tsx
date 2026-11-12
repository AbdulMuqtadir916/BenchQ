import { useEffect, useState } from "react";
import { addJob, BENCHQ_URL, type Application } from "../api";
import { ALERT, button, CARD, MUTED_TEXT, SOFT_TEXT } from "../ui";
import { CHECK, SPINNER_ICON } from "./icons";
import { sameCompany, sameListing } from "./job-check";
import { missingAccess, requestAccess, type SiteAccess } from "./site-access";
import { readJobPage } from "./tab-bridge";
import type { PageJob } from "./types";

type KnownJob = { id?: string; status?: string; title: string | null; company: string | null; location: string | null; url?: string | null };

type AddJobCardProps = {
  /** The tab the BDE is looking at. */
  tab: { id: number; url: string } | null;
  candidateId: string;
  candidateName: string;
  /** The candidate's saved and applied jobs' links: a page that is one of them isn't offered again. */
  knownUrls: readonly string[];
  /** The candidate's jobs: a page showing one of them (the same company and role) isn't offered, whatever its link. */
  knownJobs?: readonly KnownJob[];
  onAdded: (application: Application) => void;
  /** Connects this tab to the saved job it shows (#130): offered instead of adding it again. */
  onUseTab?: (job: KnownJob) => void;
};

/** When the page is read again while it shows no job yet: pages that build themselves after they load. */
const LOOK_AGAIN_MS = [1500, 4000];

/** A link without its fragment or a trailing slash, so one job's page matches however it was opened. */
const sameUrl = (url: string) => url.split("#")[0]!.replace(/\/+$/, "").toLowerCase();

/** Query keys that name a job. Other keys (tracking, the source of a click) don't tell two jobs apart. */
const JOB_KEYS = /^(gh_jid|jk|vjk|jobid|job_id|id|req|reqid|req_id|requisitionid|pid|currentjobid)$/i;

/** A host's site: its last two labels, or three under a country's second-level domain (`acme.co.uk`, `acme.com.au`). */
function siteOf(hostname: string): string {
  const labels = hostname.toLowerCase().split(".");
  const isCountrySecondLevel = labels.length >= 3 && labels.at(-1)!.length === 2 && /^(co|com|org|net|gov|ac|edu)$/.test(labels.at(-2)!);
  return labels.slice(isCountrySecondLevel ? -3 : -2).join(".");
}

/** What names a link's job: its site without the subdomain (Greenhouse sends `boards.` to `job-boards.`), its path, and
 * the query keys that name a job. */
function jobKeyOf(url: string) {
  try {
    const link = new URL(url);
    return {
      site: siteOf(link.hostname),
      path: link.pathname.toLowerCase().replace(/\/+$/, ""),
      ids: new Map([...link.searchParams].filter(([key]) => JOB_KEYS.test(key)).map(([key, value]) => [key.toLowerCase(), value])),
    };
  } catch {
    return null;
  }
}

/** The same job's page, however it was reached: the same site, the same path or a page under it (Lever's `/apply`,
 * Ashby's `/application`), and no job id that differs. */
function isSameJob(page: string, known: string): boolean {
  if (sameUrl(page) === sameUrl(known)) return true;
  const [here, saved] = [jobKeyOf(page), jobKeyOf(known)];
  if (!here || !saved || here.site !== saved.site) return false;
  const under = (inner: string, outer: string) => inner === outer || (outer.length > 1 && inner.startsWith(`${outer}/`));
  if (!under(here.path, saved.path) && !under(saved.path, here.path)) return false;
  return [...here.ids].every(([key, value]) => !saved.ids.has(key) || saved.ids.get(key) === value);
}

/** Codes that name one job in a link: a UUID (Lever, Ashby), a long number (Greenhouse, LinkedIn, SmartRecruiters), a
 * requisition code (Workday's R123456, JR-1234, REQ_5678), and a job key in the query (gh_jid, Indeed's jk). */
const ID_IN_LINK = /(?<![a-z0-9])(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{5,}|(?:jr|req|r)[-_]?\d{4,})(?![a-z0-9])/gi;

export function jobIdsOf(url: string | null | undefined): string[] {
  const key = url ? jobKeyOf(url) : null;
  if (!key) return [];
  return [...new Set([...key.ids.values(), ...(key.path.match(ID_IN_LINK) ?? [])].map((id) => id.toLowerCase()))]
    .filter((id) => id.length >= 4);
}

/** The part of a link one employer owns on a site many share: its host (Workday's acme.wd5.myworkdayjobs.com) and the
 * first step of its path (boards.greenhouse.io/acme/…), as `backend/applications/saving.py` reads it. */
function employerPartOf(url: string | null | undefined): string | null {
  try {
    const link = new URL(url ?? "");
    return `${link.hostname.toLowerCase().replace(/^www\./, "")}/${link.pathname.replace(/^\/+/, "").split("/")[0]!.toLowerCase()}`;
  } catch {
    return null;
  }
}

/** Whether the page shows a saved job by its code: a code in the page or its links that the saved job's link has too,
 * from the same employer: the same company, or the same employer's part of one site. A requisition number is unique
 * only inside one employer, so two employers on Workday with R123456 have two jobs. */
function sharesJobId(found: PageJob, known: KnownJob): boolean {
  const saved = jobIdsOf(known.url);
  const seen = new Set([...(found.ids ?? []), ...[found.url, ...(found.links ?? [])].flatMap(jobIdsOf)]);
  if (!saved.some((id) => seen.has(id))) return false;
  const part = employerPartOf(found.url);
  return (part !== null && part === employerPartOf(known.url)) || sameCompany(found.company, known.company);
}

/** Two requisitions for one role on the same employer's site are two jobs: both links carry codes and share none.
 * Codes from two sites say nothing, since each site numbers its own. */
function isOtherRequisition(found: PageJob, known: KnownJob): boolean {
  const [here, saved] = [jobIdsOf(found.url), jobIdsOf(known.url)];
  const part = employerPartOf(found.url);
  return here.length > 0 && saved.length > 0 && !here.some((id) => saved.includes(id)) && part !== null
    && part === employerPartOf(known.url);
}

/** Whether the page's job is this saved job: the same listing, unless the links name two requisitions, or a job code
 * they share from the same employer. */
export const isSavedJob = (found: PageJob, known: KnownJob) =>
  (sameListing(found, known) && !isOtherRequisition(found, known)) || sharesJobId(found, known);

/** Whether the panel looks at the page at all: a web page that isn't BenchQ's own and isn't one of the candidate's jobs. */
export const offersPage = (url: string | undefined, knownUrls: readonly string[]) =>
  Boolean(url && /^https?:\/\//i.test(url) && !url.startsWith(BENCHQ_URL) && !knownUrls.some((known) => isSameJob(url, known)));

/** Words a job page's link has in its host or path: careers.acme.com, /jobs/123, /positions/…, /apply. */
const JOB_WORDS = /(?:^|[^a-z])(?:jobs?|careers?|positions?|openings?|vacanc(?:y|ies)|requisitions?|apply|hiring|recruit(?:ing|ment)?|opportunit(?:y|ies))(?:[^a-z]|$)/i;

/** Whether a link looks like a job's page: a job word in its host or path, or a query key that names a job. On a site
 * BenchQ can't read yet it can't tell from the page, so it asks for the site only on such a link, not on every site. */
export function looksLikeJobPage(url: string): boolean {
  const key = jobKeyOf(url);
  if (!key) return false;
  return key.ids.size > 0 || JOB_WORDS.test(new URL(url).hostname) || JOB_WORDS.test(key.path);
}

/**
 * Add the job on this page to the candidate's jobs (the add-job plan, decided 2026-11-11). Shown only on a job's page
 * (`readJob`: JobPosting data, or a job link with an Apply button), and the BDE confirms first. BenchQ saves it as one of
 * the candidate's jobs and a Saved application at once; the same job again is the one they have. Then the tab connects
 * to it, ready for Autofill. On a site BenchQ may not read yet (#126) it first asks, on a link that looks like a job's
 * page, and reads the page once the BDE allows it.
 */
export default function AddJobCard({ tab, candidateId, candidateName, knownUrls, knownJobs = [], onAdded, onUseTab }: AddJobCardProps) {
  const tabId = tab && offersPage(tab.url, knownUrls) ? tab.id : null;
  const [job, setJob] = useState<PageJob | null>(null);
  const [state, setState] = useState<{ status: "idle" | "confirming" | "adding" | "added" | "error"; text?: string }>({ status: "idle" });
  // The site, while BenchQ may not read it: the page is read once the BDE allows it (`allowed` counts the grants).
  const [access, setAccess] = useState<SiteAccess | null>(null);
  const [isDenied, setIsDenied] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [allowed, setAllowed] = useState(0);

  useEffect(() => {
    if (tabId === null) return;
    let timers: ReturnType<typeof setTimeout>[] = [];
    let isLive = true;
    const look = () => void readJobPage(tabId).then((found) => {
      if (!isLive || !found?.isJobPage || !found.title || !found.company || !found.description) return;
      timers.forEach(clearTimeout);
      setJob(found);
    }, () => undefined);
    const read = () => {
      look();
      timers = LOOK_AGAIN_MS.map((wait) => setTimeout(look, wait));
    };
    // A site BenchQ may not read can't be looked at yet: the card asks for it instead.
    void missingAccess(tabId).then((missing) => {
      if (!isLive) return;
      setAccess(missing);
      if (!missing) read();
    }, () => { if (isLive) read(); });
    return () => {
      isLive = false;
      timers.forEach(clearTimeout);
    };
  }, [tabId, allowed]);

  /** Chrome's own prompt, which it shows only from a click: asked before anything is awaited. */
  const allow = async () => {
    if (!access) return;
    setIsAsking(true);
    try {
      const granted = await requestAccess(access).catch(() => false);
      setIsDenied(!granted);
      if (granted) setAllowed((count) => count + 1);
    } finally {
      setIsAsking(false);
    }
  };

  const isWebPage = Boolean(tab && /^https?:\/\//i.test(tab.url) && !tab.url.startsWith(BENCHQ_URL));
  const saved = (isWebPage && knownJobs.find((known) => known.url && isSameJob(tab!.url, known.url)))
    || (job ? knownJobs.find((known) => isSavedJob(job, known)) : undefined);
  if (saved) {
    return onUseTab && (saved.status ?? "saved") === "saved" ? <section data-slot="use-tab" className={`mb-3 grid gap-2 p-3 ${CARD}`} aria-labelledby="use-tab-title">
      <h2 id="use-tab-title" className="text-sm font-[550]">{candidateName}&apos;s job is on this page</h2>
      <p className={SOFT_TEXT}>{[saved.title, saved.company].filter(Boolean).join(" · ")}</p>
      <button type="button" data-slot="use-tab-run" className={button("primary")} onClick={() => onUseTab(saved)}>Use this tab for Autofill</button>
    </section> : null;
  }
  if (tabId !== null && access) {
    return looksLikeJobPage(tab!.url) ? <section data-slot="add-job-access" className={`mb-3 grid gap-2 p-3 ${CARD}`} aria-labelledby="add-job-access-title">
      <h2 id="add-job-access-title" className="text-sm font-[550]">A job on this page?</h2>
      <p className={SOFT_TEXT}>
        To add it to {candidateName}&apos;s Saved jobs, BenchQ needs to read <strong className="font-[550]">{access.host}</strong>.
        Chrome asks once for this site, and you can take it back any time in chrome://extensions.
      </p>
      {isDenied && <p role="alert" className={ALERT}>Not allowed. BenchQ can&apos;t read {access.host}, so it can&apos;t add this job from here.</p>}
      <button type="button" data-slot="add-job-allow" className={button("primary")} disabled={isAsking} onClick={() => void allow()}>
        {isDenied ? "Ask again" : `Allow on ${access.host}`}
      </button>
    </section> : null;
  }
  if (tabId === null || !job) return null;

  const cancel = () => setState({ status: "idle" });
  const add = async () => {
    setState({ status: "adding" });
    try {
      const application = await addJob(candidateId, job);
      setState({ status: "added", text: application.application_created ? `Added to ${candidateName}'s Saved jobs.` : `Already in ${candidateName}'s jobs.` });
      onAdded(application);
    } catch (error) {
      setState({ status: "error", text: `Couldn't add this job (${error instanceof Error ? error.message : "unknown error"}).` });
    }
  };

  return <section data-slot="add-job" className={`mb-3 grid gap-2 p-3 ${CARD}`} aria-labelledby="add-job-title">
    <h2 id="add-job-title" className="text-sm font-[550]">A job on this page</h2>
    <p className={SOFT_TEXT}>{[job.title, job.company, job.location].filter(Boolean).join(" · ")}</p>
    {state.status === "confirming"
      ? <div role="group" aria-labelledby="add-job-ask" className="grid gap-2"
        onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); cancel(); } }}>
        <p id="add-job-ask">Add this job to {candidateName}&apos;s Saved jobs?</p>
        <div className="flex gap-2">
          <button type="button" data-slot="add-job-confirm" className={button("primary")} autoFocus onClick={() => void add()}>Yes, add it</button>
          <button type="button" data-slot="add-job-cancel" className={button("secondary")} onClick={cancel}>Cancel</button>
        </div>
      </div>
      : <button type="button" data-slot="add-job-run" className={button("primary")} disabled={state.status === "adding"} onClick={() => setState({ status: "confirming" })}>
        {state.status === "adding" ? <>{SPINNER_ICON}Adding…</> : `Add this job for ${candidateName}`}
      </button>}
    {state.status === "added" && <p role="status" className={`flex items-center gap-1 ${MUTED_TEXT} [&_svg]:size-[var(--icon-sm)]`}>{CHECK}{state.text}</p>}
    {state.status === "error" && <p role="alert" className={ALERT}>{state.text}</p>}
  </section>;
}
