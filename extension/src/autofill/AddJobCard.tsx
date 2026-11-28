import { useEffect, useRef, useState, type ReactNode } from "react";
import { addJob, BENCHQ_URL, getCandidateJob, type Application, type BenchqJob } from "../api";
import { ALERT, button, MOTION, MUTED_TEXT, SOFT_TEXT } from "../ui";
import { CompanyLogo } from "./CompanyLogo";
import { CHECK, SPINNER_ICON } from "./icons";
import { readSourceJob } from "./connection-store";
import { sameCompany, sameListing, siteOf } from "./job-check";
import { detailsOf, factsOf, textOfHtml } from "./job-details";
import JobDetails from "./JobDetails";
import { missingAccess, requestAccess, type SiteAccess } from "./site-access";
import { isJobLink } from "./job-link";
import { readJobPage } from "./tab-bridge";
import type { PageJob } from "./types";

type KnownJob = { id?: string; status?: string; title: string | null; company: string | null; location: string | null; url?: string | null };

function placeholderTitle(value: string | null, ids: readonly string[] = []): boolean {
  const title = value?.trim() ?? "";
  return !title || /^(?:view job|job details?|job description|candidate center)$/i.test(title)
    || /^(?:job|req(?:uisition)?|position|posting)\s*(?:id|number|no\.?|code|#)(?=$|[\s:#.-])/i.test(title)
    || /^(?:#?\d+|(?:jr|req|r)\s*[-_]?\s*\d[\w.-]*|[a-z]{1,12}\s*[-_]\s*\d[\w.-]*)$/i.test(title)
    || ids.includes(title.replace(/\s*-\s*/g, "-").toLowerCase());
}

type AddJobCardProps = {
  /** The BDE's firm, for looking up the BenchQ job a tab was opened for. */
  firmId?: string | null;
  /** The tab the BDE is looking at. */
  tab: { id: number; url: string } | null;
  candidateId: string;
  candidateName: string;
  /** The candidate's saved and applied jobs' links: a page that is one of them isn't offered again. */
  knownUrls: readonly string[];
  /** The candidate's jobs: a page showing one of them (the same company and role) isn't offered, whatever its link. */
  knownJobs?: readonly KnownJob[];
  onPageTitle?: (id: string, title: string) => void;
  onAdded: (application: Application) => void;
  /** Connects this tab to the saved job it shows (#130): offered instead of adding it again. */
  onUseTab?: (job: KnownJob) => void;
  /** Whether the card shows a job (to add, to use, or to allow reading): the panel is then the page that adds it. */
  onShown?: (isShown: boolean) => void;
  /** Whether it shows the job's details page (See full job details): the panel is then that page alone. */
  onDetailsShown?: (isShown: boolean) => void;
};

/** The card that adds a job, as the design has it: a large logo and the role over a line, then its facts in a grid.
 * Save is under the card, and the job's whole posting a press away. */
const ADD_CARD = "grid gap-5 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]";
/** A fact's name or a field's label: small capitals, wide spacing. */
const LABEL = "text-caption font-[700] uppercase tracking-wider text-[var(--color-text-3)]";
const VALUE = "text-sm font-[600] text-[var(--color-text)] wrap-anywhere";
/** An input of the edit form: an opaque box that turns blue when it has the focus. */
const INPUT = `w-full rounded-[var(--radius-lg)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-3)] transition-[border-color,box-shadow] ${MOTION} focus-visible:border-[var(--color-primary)] focus-visible:shadow-[var(--ring-input)] focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-[var(--color-surface-2)]`;
/** The page that adds a job, under the candidate: it scrolls on its own, so a long edit form never cuts off what's under
 * it, with room under the last link. */
const PAGE = "-mx-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-0.5 pb-5 [scrollbar-color:var(--color-border-strong)_transparent] [scrollbar-width:thin]";
/** A quiet action under Save: Edit details, See full job details. */
const QUIET_ACTION = `inline-flex items-center gap-1.5 text-caption font-[650] text-[var(--color-text-3)] transition-[color] ${MOTION} hover:text-[var(--color-text)] [&_svg]:size-[var(--icon-sm)] [&_svg]:flex-none`;
const FIELD_LABELS = { title: "Job title", company: "Company", location: "Location", description: "Description" } as const;

/** A posting's description as text: its HTML (a JobPosting's) read, with a line for each paragraph and list item. */
function plainText(description: string): string {
  if (!/<[a-z][\s\S]*>/i.test(description)) return description.trim();
  const lined = description.replace(/<(?:br|\/p|\/li|\/h[1-6]|\/div|\/ul|\/ol)\b[^>]*>/gi, "\n");
  const text = textOfHtml(lined);
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** When the page is read again while it shows no job yet: pages that build themselves after they load, or after an
 * app moves to another job in place, which can take a while to fetch it. Stops once the job is found. */
const LOOK_AGAIN_MS = [1000, 2500, 5000, 9000, 15000];

/** A link without its fragment or a trailing slash, so one job's page matches however it was opened. */
const sameUrl = (url: string) => url.replace(/#(?:top|apply|application|description)?$/i, "").replace(/\/+$/, "");

type Draft = Partial<Pick<PageJob, "title" | "company" | "location" | "description">>;

/** The BDE's edits to a page's job, by the job's link, while the panel is open: they stay when the page is read again,
 * when the card is drawn afresh (another tab and back, the tab's link changing) and when Save finds the page changed. */
const drafts = new Map<string, Draft>();
const draftKey = (job: PageJob) => sameUrl(job.postingUrl ?? job.url);
const savedDraft = (job: PageJob) => drafts.get(draftKey(job)) ?? drafts.get(sameUrl(job.url));

const sameText = (one: string | null | undefined, other: string | null | undefined) =>
  (one ?? "").replace(/\s+/g, " ").trim().toLowerCase() === (other ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** Whether a fresh reading of the page is still the job on the card: its page (or one under it, its form), its title
 * and company however spaced or cased, and its requisition when both readings name one (a JobPosting that loads late
 * adds it). Another job means the card's details, and any edits to them, were for a job the tab no longer shows. */
function isSamePosting(fresh: PageJob | null | undefined, job: PageJob): boolean {
  return Boolean(fresh?.isJobPage && isSameJob(fresh.url, job.url) && sameText(fresh.title, job.title) && sameText(fresh.company, job.company)
    && (!fresh.requisitionId || !job.requisitionId || fresh.requisitionId === job.requisitionId));
}

/** Query keys that name a job. Other keys (tracking, the source of a click) don't tell two jobs apart. */
const JOB_KEYS = /^(gh_jid|jk|vjk|jobid|job_id|id|req|reqid|req_id|requisitionid|pid|currentjobid)$/i;

/** What names a link's job: its site without the subdomain (Greenhouse sends `boards.` to `job-boards.`), its path, and
 * the query keys that name a job. */
function jobKeyOf(url: string) {
  try {
    const link = new URL(url);
    const site = siteOf(link.hostname);
    const path = link.pathname.toLowerCase().replace(/\/+$/, "");
    return {
      site,
      board: link.hostname.replace(/^www\./, "").replace(/^(?:job-boards|boards)\.greenhouse\.io$/, "boards.greenhouse.io"),
      route: /^#!?\/|[?&=]/.test(link.hash) ? link.hash : "",
      // Adzuna's tracked link (/land/ad/<id>) opens the listing (/details/<id>): one job at two addresses.
      path: site === "adzuna.com" ? path.replace(/^\/land\/ad\/(\d+)$/, "/details/$1") : path,
      ids: new Map([...link.searchParams].filter(([key]) => JOB_KEYS.test(key)).map(([key, value]) => [key.toLowerCase(), value])),
    };
  } catch {
    return null;
  }
}

/** The same job's page, however it was reached: the same site, the same path or a page under it (Lever's `/apply`,
 * Ashby's `/application`), and no job id that differs. */
export function isSameJob(page: string, known: string): boolean {
  if (sameUrl(page) === sameUrl(known)) return true;
  const [here, saved] = [jobKeyOf(page), jobKeyOf(known)];
  if (!here || !saved || here.board !== saved.board || here.route !== saved.route) return false;
  const under = (inner: string, outer: string) => inner === outer || (outer.length > 1 && inner.startsWith(`${outer}/`));
  if (!under(here.path, saved.path) && !under(saved.path, here.path)) return false;
  // The same job ids on both, or one side's id written in the other's path (Greenhouse's gh_jid=8329677 on
  // /jobs/8329677): an id the other side has nowhere can be another job's.
  return [...new Set([...here.ids.keys(), ...saved.ids.keys()])].every((key) => {
    const [mine, theirs] = [here.ids.get(key), saved.ids.get(key)];
    if (mine !== undefined && theirs !== undefined) return mine === theirs;
    const segments = (mine === undefined ? here.path : saved.path).split("/");
    return segments.includes((mine ?? theirs ?? "").toLowerCase());
  });
}

/** The connected tab moved on to another job's page on the job's own site (another posting on its board): not the job's
 * page or one under it (its application form), so the panel asks whether to disconnect. A page on another site never
 * asks: an application often goes on there (a company page that sends the BDE to its ATS). */
export function isOtherJobOnSite(page: string, job: string): boolean {
  const [here, saved] = [jobKeyOf(page), jobKeyOf(job)];
  return Boolean(here && saved && here.site === saved.site) && isJobLink(page) && !isSameJob(page, job);
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

/** Whether a link is one job's page (`isJobLink`: the job named in its query or reached past a job word, never a careers
 * home or a list of jobs). On a site BenchQ can't read yet it can't tell from the page, so it asks for the site only on
 * such a link, not on every site. */
export const looksLikeJobPage = (url: string) => isJobLink(url);

/**
 * Add the job on this page to the candidate's jobs (the add-job plan, decided 2026-11-11). Shown only on a job's page
 * (`readJob`: JobPosting data, or a job link with an Apply button), and the BDE explicitly saves it for the named candidate. BenchQ saves it as one of
 * the candidate's jobs and a Saved application at once; the same job again is the one they have. Then the tab connects
 * to it, ready for Autofill. On a site BenchQ may not read yet (#126) it first asks, on a link that looks like a job's
 * page, and reads the page once the BDE allows it.
 */
export default function AddJobCard(props: AddJobCardProps) {
  return <CaptureCard key={JSON.stringify([props.firmId, props.candidateId, props.tab?.id, props.tab?.url])} {...props} />;
}

function CaptureCard({ tab, firmId, candidateId, candidateName, knownUrls, knownJobs = [], onAdded, onUseTab, onPageTitle, onShown, onDetailsShown }: AddJobCardProps) {
  // Re-read only legacy placeholders whose saved URL identifies this exact posting.
  const legacy = knownJobs.find(known => tab && known.url === tab.url
    && placeholderTitle(known.title, jobIdsOf(tab.url)));
  const legacyId = legacy?.id;
  const legacyUrl = legacy?.url;
  const tabId = tab && offersPage(tab.url, legacyId ? [] : knownUrls) ? tab.id : null;
  const [job, setJob] = useState<PageJob | null>(null);
  // The BDE's edits, by the job's link alone: a later reading of the same page (a fuller one, a requisition ID that
  // loads late) keeps them, and so does a card drawn afresh (`drafts`).
  const [edits, setEdits] = useState<{ key: string; values: Draft }>();
  const key = job ? draftKey(job) : "";
  const draft: Draft = !job ? {} : edits?.key === key ? edits.values : savedDraft(job) ?? {};
  const [editing, setEditing] = useState(false);
  const setDraft = (values: Draft) => {
    drafts.set(key, values);
    setEdits({ key, values });
    // An edit keeps the form open until Done, even once it fills the last field the form opened for.
    setEditing(true);
  };
  const [isDetailsShown, setIsDetailsShown] = useState(false);
  const firstName = candidateName.trim().split(/\s+/)[0] || candidateName;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // The BenchQ job this tab was opened for from the website, when this candidate has it: Save saves that job itself.
  // Kept with the candidate it was looked up for: another candidate's posting is never saved by its id for this one.
  const [lookup, setLookup] = useState<{ tabId: number; candidateId: string; firmId: string; job: BenchqJob | null } | null>(null);
  const currentLookup = lookup?.tabId === tabId && lookup.candidateId === candidateId && lookup.firmId === firmId ? lookup : null;
  const known = currentLookup?.job ?? null;
  const isLookingUp = Boolean(firmId && tabId !== null && !currentLookup);
  const [state, setState] = useState<{ status: "idle" | "adding" | "added" | "error"; text?: string }>({ status: "idle" });
  useEffect(() => {
    if (tabId === null || !firmId) return;
    let isLive = true;
    void readSourceJob(tabId).catch(() => null).then((jobId) => (jobId ? getCandidateJob(firmId, candidateId, jobId) : null)).then(
      (found) => { if (isLive) setLookup({ tabId, candidateId, firmId, job: found }); },
      (error: unknown) => {
        // A 404 is a job this candidate doesn't have, so the page's reading is what gets saved. Anything else is said.
        if (isLive) setLookup({ tabId, candidateId, firmId, job: null });
        if (isLive && (error as { status?: number }).status !== 404) {
          setState({ status: "error", text: "Couldn't check whether BenchQ already has this job. Saving uses what the page shows." });
        }
      });
    return () => { isLive = false; };
  }, [tabId, firmId, candidateId]);
  // The site, while BenchQ may not read it: the page is read once the BDE allows it (`allowed` counts the grants).
  const [access, setAccess] = useState<SiteAccess | null>(null);
  const [isDenied, setIsDenied] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [allowed, setAllowed] = useState(0);
  useEffect(() => {
    if (tabId === null) return;
    let timers: ReturnType<typeof setTimeout>[] = [];
    let isLive = true;
    // Looks for the whole schedule: a page that adds its JobPosting data after it shows (Oracle's) gives more on a later
    // look, and the card takes that fuller reading of the same job.
    let latest = 0;
    const look = () => {
      const readNumber = ++latest;
      void readJobPage(tabId).then(found => {
        if (!isLive || readNumber !== latest || !found?.isJobPage) return;
        if (legacyId && found.title && found.url === legacyUrl) onPageTitle?.(legacyId, found.title);
        setJob(shown => !shown || shown.url === found.url ? found : shown);
      }, () => undefined);
    };
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
  }, [tabId, allowed, legacyId, legacyUrl, onPageTitle]);

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

  const view = (): { node: ReactNode; isJob: boolean; isDetails?: boolean } => {
  const isWebPage = Boolean(tab && /^https?:\/\//i.test(tab.url) && !tab.url.startsWith(BENCHQ_URL));
  const saved = (isWebPage && knownJobs.find((known) => known.url && isSameJob(tab!.url, known.url)))
    || (job ? knownJobs.find((known) => isSavedJob(job, known)) : undefined);
  if (saved) {
    if (!onUseTab || (saved.status ?? "saved") !== "saved") return { node: null, isJob: false };
    return { isJob: true, node: <section data-slot="use-tab" className={ADD_CARD} aria-labelledby="use-tab-title">
      <div className="flex min-w-0 items-center gap-4">
        <CompanyLogo company={saved.company || saved.title || "Job"} size="xl" />
        <div className="grid min-w-0">
          <h2 id="use-tab-title" className="truncate text-h3 font-[700] leading-tight" title={saved.title ?? undefined}>{saved.title}</h2>
          <p className="truncate text-sm text-[var(--color-text-2)]">{[saved.company, `Saved for ${candidateName}`].filter(Boolean).join(" · ")}</p>
        </div>
      </div>
      <button type="button" data-slot="use-tab-run" className={`w-full ${button("primary", "large")}`} onClick={() => onUseTab(saved)}>Use this tab for Autofill</button>
    </section> };
  }
  if (tabId !== null && access) {
    if (!looksLikeJobPage(tab!.url)) return { node: null, isJob: false };
    return { isJob: true, node: <section data-slot="add-job-access" className={ADD_CARD} aria-labelledby="add-job-access-title">
      <h2 id="add-job-access-title" className="text-sm font-[550]">Read this job for {candidateName}?</h2>
      <p className={SOFT_TEXT}>
        To add it to {candidateName}&apos;s Saved jobs, BenchQ needs to read <strong className="font-[550]">{access.host}</strong>.
        Choose Allow when Chrome asks.
      </p>
      {isDenied && <p role="alert" className={ALERT}>Not allowed. BenchQ can&apos;t read {access.host}, so it can&apos;t add this job from here.</p>}
      <button type="button" data-slot="add-job-allow" className={`w-full ${button("primary", "large")}`} disabled={isAsking} onClick={() => void allow()}>
        {isDenied ? "Ask again" : `Allow on ${access.host}`}
      </button>
    </section> };
  }
  if (tabId === null || !job) return { node: state.status === "error" ? <p className={ALERT} role="alert">{state.text}</p> : null, isJob: false };

  // Still the page of the job BenchQ has (not one the tab moved on to): show BenchQ's details, not the page's reading.
  const sameKnown = known?.url && isSameJob(job.url, known.url) ? known : null;
  const shown: PageJob = sameKnown ? { ...job, title: placeholderTitle(sameKnown.title, job.ids) ? job.title : sameKnown.title!, company: sameKnown.company || job.company,
    location: sameKnown.location ?? job.location, description: sameKnown.description || job.description } : { ...job, ...draft };
  // The page's logo stays while the company is still the page's: an edit that tidies its name keeps it.
  if (shown.company !== job.company && !sameCompany(shown.company, job.company)) delete shown.logoUrl;
  const description = plainText(shown.description);
  const missing = !shown.title.trim() || !shown.company.trim() || !description;
  const isAdded = state.status === "added";
  const isBusy = state.status === "adding";
  const editFields = !sameKnown && !isAdded && (editing || missing);
  const details = detailsOf(shown);
  const add = async () => {
    setIsDetailsShown(false);
    setState({ status: "adding" });
    try {
      const fresh = await readJobPage(tabId);
      if (!mounted.current) return;
      if (!isSamePosting(fresh, job)) {
        // The card shows what the page shows now. The BDE's edits stay with this posting's link (`drafts`): another
        // job's page starts from its own reading, and the same one again has them back.
        setJob(fresh?.isJobPage ? fresh : null);
        setState({ status: "error", text: "The posting changed. Review its current details before saving." });
        return;
      }
      const application = await (sameKnown ? addJob(candidateId, shown, sameKnown) : addJob(candidateId, shown));
      if (!mounted.current) return;
      // Saved: the edits are the job's now. The card keeps showing them until the tab connects to it.
      drafts.delete(key);
      setState({ status: "added", text: sameKnown ? `Saved to ${candidateName}'s jobs.`
        : application.application_created ? `Added to ${candidateName}'s Saved jobs.` : `Already in ${candidateName}'s jobs.` });
      onAdded(application);
    } catch (error) {
      setState({ status: "error", text: `Couldn't add this job. ${error instanceof Error ? error.message : "Try again."}` });
    }
  };

  const save = !isAdded && <button type="button" data-slot="add-job-run" className={`w-full ${button("primary", "large")}`} disabled={isBusy || isLookingUp || (!sameKnown && missing)} onClick={() => void add()}>
    {isBusy ? <>{SPINNER_ICON}Saving…</> : `Save job for ${firstName}`}
  </button>;
  if (isDetailsShown) {
    // The design's Job Details page, for the job as the card has it (the BDE's edits too), with Save at its foot.
    const facts = factsOf({ title: shown.title || "Job on this page", company: shown.company, location: shown.location,
      logoUrl: shown.logoUrl, description: shown.description }, shown);
    return { isJob: true, isDetails: true, node: <JobDetails job={facts} onBack={() => setIsDetailsShown(false)} actions={<>
      <button type="button" data-slot="add-job-details-back" className={button("secondary", "large")} onClick={() => setIsDetailsShown(false)}>Back</button>
      {save}
    </>} /> };
  }

  const fields = ["title", "company", "location", "description"] as const;
  const hasBody = Boolean(sameKnown) || editFields || details.length > 0;
  return { isJob: true, node: <div data-slot="add-job-page" className={PAGE}><div className="grid gap-4">
    <section data-slot="add-job" className={ADD_CARD} aria-labelledby="add-job-title">
      <div className={`flex min-w-0 items-center gap-4 ${hasBody ? "border-b border-[var(--color-border)] pb-5" : ""}`}>
        <CompanyLogo company={shown.company || shown.title || "Job"} url={shown.logoUrl} size="xl" />
        <div className="grid min-w-0">
          <h2 id="add-job-title" className="truncate text-h3 font-[700] leading-tight" title={shown.title || undefined}>{shown.title || "Job on this page"}</h2>
          <p className="mt-0.5 truncate text-sm text-[var(--color-text-2)]">{shown.company || "Company not listed"}</p>
          {shown.location && <p className="mt-1 truncate text-caption text-[var(--color-text-3)]" title={shown.location}>{shown.location}</p>}
        </div>
      </div>
      {sameKnown && <p data-slot="add-job-known" className={MUTED_TEXT}>{`This job is already in BenchQ. Save it to ${candidateName}'s jobs.`}</p>}
      {editFields && <fieldset disabled={isBusy} data-slot="add-job-form" className="grid gap-3">
        <legend className="sr-only">The job&apos;s details</legend>
        {fields.map((field) => <label key={field} className="grid gap-1.5">
          <span className={LABEL}>{FIELD_LABELS[field]}</span>
          {/* The description as text to edit, not the posting's HTML. Left alone, the posting's own is what's saved. */}
          {field === "description"
            ? <textarea className={`${INPUT} min-h-28 resize-y`} rows={6} value={draft.description ?? plainText(job.description)} maxLength={100000} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
            : <input className={INPUT} value={shown[field] ?? ""} maxLength={300} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} />}
        </label>)}
      </fieldset>}
      {details.length > 0 && <dl data-slot="add-job-details" className="grid grid-cols-2 gap-x-3 gap-y-4">
        {details.map(([name, value]) => <div key={name} className={`grid min-w-0 gap-1 ${name === "Pay" ? "col-span-2" : ""}`}>
          <dt className={LABEL}>{name}</dt>
          <dd className={VALUE}>{value}</dd>
        </div>)}
      </dl>}
    </section>
    {save}
    {isAdded && <p role="status" className={`flex items-center justify-center gap-1 ${MUTED_TEXT} [&_svg]:size-[var(--icon-sm)]`}>{CHECK}{state.text}</p>}
    {state.status === "error" && <p role="alert" className={ALERT}>{state.text}</p>}
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
      {!sameKnown && !isAdded && !isBusy && (editFields
        ? !missing && <button type="button" data-slot="add-job-done" className={QUIET_ACTION} onClick={() => setEditing(false)}>Done editing</button>
        : <button type="button" data-slot="add-job-edit" className={QUIET_ACTION} onClick={() => setEditing(true)}>Edit details</button>)}
      <button type="button" data-slot="add-job-more" className={QUIET_ACTION} onClick={() => setIsDetailsShown(true)}>See full job details</button>
    </div>
  </div></div> };
  };
  const { node, isJob, isDetails = false } = view();
  useEffect(() => { onShown?.(isJob); }, [isJob, onShown]);
  useEffect(() => () => onShown?.(false), [onShown]);
  useEffect(() => { onDetailsShown?.(isDetails); }, [isDetails, onDetailsShown]);
  useEffect(() => () => onDetailsShown?.(false), [onDetailsShown]);
  return node;
}
