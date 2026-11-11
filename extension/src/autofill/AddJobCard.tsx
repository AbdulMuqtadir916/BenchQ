import { useEffect, useState } from "react";
import { addJob, BENCHQ_URL, type Application } from "../api";
import { ALERT, button, CARD, MUTED_TEXT, SOFT_TEXT } from "../ui";
import { CHECK, SPINNER_ICON } from "./icons";
import { sameCompany, sameListing } from "./job-check";
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

/** Whether the page shows a saved job by its code: a code in the page or its links that the saved job's link has too,
 * on the same site or at the same company (a requisition number is unique only inside one company). */
function sharesJobId(found: PageJob, known: KnownJob): boolean {
  const saved = jobIdsOf(known.url);
  const seen = new Set([...(found.ids ?? []), ...[found.url, ...(found.links ?? [])].flatMap(jobIdsOf)]);
  if (!saved.some((id) => seen.has(id))) return false;
  return jobKeyOf(found.url)?.site === jobKeyOf(known.url ?? "")?.site || sameCompany(found.company, known.company);
}

/** Whether the panel looks at the page at all: a web page that isn't BenchQ's own and isn't one of the candidate's jobs. */
export const offersPage = (url: string | undefined, knownUrls: readonly string[]) =>
  Boolean(url && /^https?:\/\//i.test(url) && !url.startsWith(BENCHQ_URL) && !knownUrls.some((known) => isSameJob(url, known)));

/**
 * Add the job on this page to the candidate's jobs (the add-job plan, decided 2026-11-11). Shown only on a job's page
 * (`readJob`: JobPosting data, or a job link with an Apply button), and the BDE confirms first. BenchQ saves it as one of
 * the candidate's jobs and a Saved application at once; the same job again is the one they have. Then the tab connects
 * to it, ready for Autofill.
 */
export default function AddJobCard({ tab, candidateId, candidateName, knownUrls, knownJobs = [], onAdded, onUseTab }: AddJobCardProps) {
  const tabId = tab && offersPage(tab.url, knownUrls) ? tab.id : null;
  const [job, setJob] = useState<PageJob | null>(null);
  const [state, setState] = useState<{ status: "idle" | "confirming" | "adding" | "added" | "error"; text?: string }>({ status: "idle" });

  useEffect(() => {
    if (tabId === null) return;
    let timers: ReturnType<typeof setTimeout>[] = [];
    let isLive = true;
    const look = () => void readJobPage(tabId).then((found) => {
      if (!isLive || !found?.isJobPage || !found.title || !found.company || !found.description) return;
      timers.forEach(clearTimeout);
      setJob(found);
    }, () => undefined);
    look();
    timers = LOOK_AGAIN_MS.map((wait) => setTimeout(look, wait));
    return () => {
      isLive = false;
      timers.forEach(clearTimeout);
    };
  }, [tabId]);

  const isWebPage = Boolean(tab && /^https?:\/\//i.test(tab.url) && !tab.url.startsWith(BENCHQ_URL));
  const saved = (isWebPage && knownJobs.find((known) => known.url && isSameJob(tab!.url, known.url)))
    || (job ? knownJobs.find((known) => sameListing(job, known) || sharesJobId(job, known)) : undefined);
  if (saved) {
    return onUseTab && (saved.status ?? "saved") === "saved" ? <section data-slot="use-tab" className={`mb-3 grid gap-2 p-3 ${CARD}`} aria-labelledby="use-tab-title">
      <h2 id="use-tab-title" className="text-sm font-[550]">{candidateName}&apos;s job is on this page</h2>
      <p className={SOFT_TEXT}>{[saved.title, saved.company].filter(Boolean).join(" · ")}</p>
      <button type="button" data-slot="use-tab-run" className={button("primary")} onClick={() => onUseTab(saved)}>Use this tab for Autofill</button>
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
