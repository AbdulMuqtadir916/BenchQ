import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getResumeAnswers, getResumeFile, isSessionExpired } from "../api";
import { withResumeFile } from "./documents";
import { appliedForm, fieldLabel, forgetForms, formOf, rememberRows } from "./form-memory";
import { checkJob, hostOf } from "./job-check";
import { withJobSite } from "./job-site";
import { answersFromResume } from "./resume-answers";
import { buildReview, suggestedRow } from "./review";
import { missingAccess, requestAccess, type SiteAccess } from "./site-access";
import {
  chooseChoice, fillChoice, fillField, flaggedFields, focusField, listChoices, readTab, rejectedFields, removeFileOnPage, scanTab, takeBackField, undoCount, undoFills,
  type TabScan,
} from "./tab-bridge";
import type {
  AppliedForm, AutofillRun, BankEntry, Connection, FillResult, FieldWrite, PageSignals, ResumeFile, ReviewRow, RunItem, TabField,
} from "./types";

const RESCAN_DELAY_MS = 500;
const WATCH_MS = 2000;
const LAST_LOOK_MS = 4000;
const TOP_FRAME = 0;
const LATE_CHECK_MS = 300;
/** A run fills what it found, then once more for questions its answers brought out, like "If yes, which visa?". */
const PASSES = 2;
/** Once the résumé is attached, the form is read every 400 ms until it has been still for three looks, after five at
 * least (2 s) and 30 at most: a site that reads the file (Lever's "Analyzing resume…") fills fields of its own first. */
const SETTLE = { every: 400, least: 5, still: 3, most: 30 };
/** Once BenchQ took its old file off, the page only has to bring its upload back: a look every 250 ms, still for one. */
const SETTLE_AFTER_REMOVE = { every: 250, least: 2, still: 1, most: 16 };
/** What a run is doing before it fills, said in the panel so a change of résumé never looks stuck. */
const STEP_REMOVING = "Taking the old resume's file off…";
const STEP_CLEARING = "Clearing what the old resume filled…";
const STEP_READING = "Letting the page read the file…";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const STALE: FillResult = { status: "stale", current: "" };
const PAGE_UNREADABLE = "BenchQ can't read this page. You can still fill the form yourself.";
const REVIEW_FAILED = "BenchQ couldn't work out this form.";
const ANSWERS_UNAVAILABLE = "Could not load this resume's answers. Try again.";
const PAGE_RESET = "The page reset this value.";
const FORM_FLAGGED = "The form flagged this value.";
const RUN_STOPPED = "The form changed, so BenchQ stopped here.";
/** A résumé upload the page swapped out once it took a file (a chip for it, with a new input): the BDE changes it there. */
const UPLOAD_GONE = "The page changed this upload, so change the file there.";
const FAILURE_REASONS: Partial<Record<FillResult["status"], string>> = {
  changed: "This field changed after the review.",
  failed: "The form didn't accept this value.",
  "no-match": "None of the form's options clearly match this answer.",
};

export type Outcome = { filled: number; handedBack: number; stopped: boolean };
type FillableRow = ReviewRow & { write: FieldWrite };
type Pass = { filled: FillableRow[]; failed: number; late: number; stopped: boolean };

const isAttachment = (row: FillableRow) => row.write.type === "file";
const isFillable = (row: ReviewRow): row is FillableRow => row.status === "ready" && Boolean(row.write);

/** `resumeId`: the résumé version the answers come from (docs/02 §8.1); null when the candidate has none, so the form is
 * reviewed with no answers; undefined while the panel is still finding out, so nothing is reviewed yet. `fileName`: what
 * its file is called on the form, without the extension (07 Q52). */
type Options = {
  connection: Connection;
  firmId: string | null;
  resumeId: string | null | undefined;
  fileName?: string | null;
  onSessionExpired: () => void;
  onAccessLost: () => void;
};

/** What a tab's review remembers while the panel is open. Switching tabs unmounts the review, so this lives outside it. */
type TabMemory = {
  lastScan: number;
  // What each field held once BenchQ filled it. A form can reformat a value, and that field is done, not fillable again.
  settled: Map<string, string>;
  // What BenchQ couldn't fill, and why. Those are the BDE's until the page loads again.
  handedBack: Map<string, string>;
  // What each field held when last read, and the fields that changed since without BenchQ: Autofill leaves those alone.
  seen: Map<string, string>;
  edited: Set<string>;
  // Fields that held a value when BenchQ first saw them, typed earlier or filled by the site: Autofill leaves those too.
  found: Set<string>;
  // Dropdowns Autofill opened and found no clear option in: the BDE can pick one from the panel.
  unmatched: Set<string>;
  // The résumé each of BenchQ's fills came from. Another résumé picked later refills those fields, and only those.
  filledFrom: Map<string, string | null>;
  // The file BenchQ attached to each upload: the Resume section still shows it when the site swaps the input for a chip.
  attached: Map<string, string>;
};

/** What a page load wipes. */
const pageMemory = () => ({
  settled: new Map<string, string>(), handedBack: new Map<string, string>(), seen: new Map<string, string>(), edited: new Set<string>(),
  found: new Set<string>(), unmatched: new Set<string>(), filledFrom: new Map<string, string | null>(), attached: new Map<string, string>(),
});

const tabMemory = new Map<string, TabMemory>();

function memoryOf({ tabId, applicationId }: Connection): TabMemory {
  const key = `${tabId}:${applicationId}`;
  const found = tabMemory.get(key);
  if (found) return found;
  const fresh: TabMemory = { lastScan: 0, ...pageMemory() };
  tabMemory.set(key, fresh);
  return fresh;
}

export function forgetTabs() {
  tabMemory.clear();
  forgetForms();
}

/** What a tab remembers a field by: the control itself, which keeps its id while the page lasts, else its label and
 * place. A block of fields added above it then can't move what's remembered onto another field. */
const memoKeyOf = ({ key, field }: Pick<ReviewRow, "key" | "field">) => (field.stableId ? `${field.frameId}:${field.stableId}` : key);

/** The message plus why, so a failure says what actually went wrong instead of looking like every other one. */
function explain(message: string, error: unknown): string {
  console.error("BenchQ autofill:", error);
  return `${message} (${error instanceof Error ? error.message : String(error)})`;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Fresh rows, given what the tab remembers. `justFilled` marks a look straight after BenchQ wrote to the form: what
 * changed then is BenchQ's doing. Any other change is the BDE's, and Autofill won't write over it, nor over a value the
 * form held when BenchQ first saw it: that one shows as kept, for the BDE to replace if they want. A field BenchQ
 * filled from another résumé than `resume` is ready again when this résumé answers it differently. */
function withMemory(rows: ReviewRow[], memory: TabMemory, resume: string | null, justFilled?: ReadonlySet<string>): ReviewRow[] {
  const { settled, handedBack, seen, edited, found, unmatched, filledFrom } = memory;
  return rows.map((row) => {
    const key = memoKeyOf(row);
    const { field: { current } } = row;
    // A fill of BenchQ's from another résumé, untouched since, that this résumé doesn't answer: it mustn't stay behind.
    const isStale = filledFrom.has(key) && filledFrom.get(key) !== resume && Boolean(current) && settled.get(key) === current;
    // Never filled, so there's nothing to remember, and a value like an SSN shouldn't linger here. Only an upload BenchQ
    // attached can be stale: the picked résumé has no file of its own.
    if (row.status === "blocked") return isStale && row.field.kind === "file" ? { ...row, isStale: true } : row;
    if (justFilled?.has(key)) {
      if (current) settled.set(key, current);
      else handedBack.set(key, PAGE_RESET);
    }
    const last = seen.get(key);
    seen.set(key, current);
    if (last === undefined && current && !justFilled?.has(key)) found.add(key);
    if (!justFilled && last !== undefined && last !== current) {
      edited.add(key);
      handedBack.delete(key);
    }
    const isOtherResumes = filledFrom.has(key) && filledFrom.get(key) !== resume;
    // The new context proposes the exact value already on the page. Keep it and update its source instead of taking it
    // back as stale and leaving the field empty.
    if (isOtherResumes && row.status === "same") {
      filledFrom.set(key, resume);
      return row;
    }
    if (row.status !== "ready") return isStale ? { ...row, isStale: true } : row;
    if ((settled.get(key) === current && !isOtherResumes) || (current && edited.has(key))) return { ...row, status: "same" as const };
    if (current && found.has(key) && !settled.has(key)) return { ...row, status: "kept" as const };
    const reason = handedBack.get(key);
    if (!reason) return row;
    const handed = { ...row, status: "manual" as const, reason, write: undefined };
    return unmatched.has(key) ? { ...handed, canChoose: true } : handed;
  });
}

/** One connected tab's review, held in memory: scan the page, match it against the picked résumé's answers, fill what
 * has an answer, verify it stuck, follow what happens on the form, and undo. Unmounting (another tab, sign-out) drops
 * the answers. */
export function useAutofill({ connection, firmId, resumeId, fileName = null, onSessionExpired, onAccessLost }: Options) {
  const { tabId, applicationId, candidateId, job, confirmedHosts } = connection;
  // The résumé and application context the review in hand answers from; selection changes wait for this exact scan.
  const [answeredFrom, setAnsweredFrom] = useState<string | null | undefined>(undefined);
  const [reviewedFor, setReviewedFor] = useState<{ applicationId: string; candidateId: string; resumeId: string | null } | null>(null);
  const resumeSource = `${applicationId}:${candidateId}:${resumeId ?? "none"}`;
  // The source of BenchQ's fills includes the linked application: same résumé, different job context can change answers.
  const resume = useRef(resumeSource);
  useEffect(() => { resume.current = resumeSource; }, [resumeSource]);
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState("");
  // The site this tab is on, while Chrome hasn't been told BenchQ may read it (a site outside the built-in list).
  const [access, setAccess] = useState<SiteAccess | null>(null);
  const [isAccessDenied, setIsAccessDenied] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  // The site asked about last, and whether Chrome's prompt is open: a second click while it is waits for the first.
  const accessKey = useRef("");
  const asking = useRef(false);
  const [bankEmpty, setBankEmpty] = useState(false);
  const [unreadableFrames, setUnreadableFrames] = useState(0);
  const [signals, setSignals] = useState<PageSignals | null>(null);
  const memory = useRef(memoryOf(connection));
  // What the run is doing before it fills (taking the old file off, attaching, waiting for the page), for the panel.
  const [step, setStep] = useState<string | null>(null);
  // The last file BenchQ attached on this page (07 Q53).
  const [attachedFile, setAttachedFile] = useState<string | null>(() => [...memoryOf(connection).attached.values()].at(-1) ?? null);
  const [filling, setFilling] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [run, setRun] = useState<AutofillRun | null>(null);
  const [undoable, setUndoable] = useState(0);
  const [undoNote, setUndoNote] = useState("");
  const latestScan = useRef(0);
  const isScanRunning = useRef(false);
  const busy = useRef(false);
  const frames = useRef<Pick<TabScan, "scanIds" | "unreadableFrames">>({ scanIds: new Map(), unreadableFrames: 0 });
  const shownRows = useRef<ReviewRow[] | null>(null);
  const bank = useRef<{ resumeId: string | null; entries: BankEntry[]; file: ResumeFile | null } | null>(null);
  // The picked résumé's file, by version: a version's file never changes, so it's fetched once. Null: it has none.
  const files = useRef<{ resumeId: string; found: { mimeType: string; data: string } | null } | null>(null);
  // The name of the file Autofill attaches to the résumé upload, while the picked résumé has one.
  const [attachment, setAttachment] = useState<string | null>(null);

  /** The picked résumé's answers, with "How did you hear about us?" from where BenchQ found the job. No résumé, no
   * answers. A backend that sends no autofill for the version can't answer either. */
  const loadAnswers = useCallback(async (): Promise<BankEntry[] | null> => {
    if (!resumeId) return [];
    if (!firmId) {
      setError(ANSWERS_UNAVAILABLE);
      return null;
    }
    try {
      const entries = await getResumeAnswers(firmId, candidateId, resumeId);
      if (entries) return withJobSite(answersFromResume(entries), job);
      setError(ANSWERS_UNAVAILABLE);
      return null;
    } catch (e) {
      if (isSessionExpired(e)) onSessionExpired();
      else if ((e as { status?: number }).status === 404) onAccessLost();
      else setError(ANSWERS_UNAVAILABLE);
      return null;
    }
  }, [firmId, candidateId, resumeId, job, onSessionExpired, onAccessLost]);

  /** The picked résumé's file, when it has one (an uploaded base's first version, 07 Q49), named for the form (Q52).
   * One that won't load leaves the upload to the BDE, as a version without a file does. */
  const loadFile = useCallback(async (): Promise<ResumeFile | null> => {
    if (!resumeId || !firmId) return null;
    let found = files.current?.resumeId === resumeId ? files.current.found : undefined;
    if (found === undefined) {
      found = await getResumeFile(firmId, candidateId, resumeId).catch(() => undefined);
      if (found === undefined) return null;
      files.current = { resumeId, found };
    }
    return found && { ...found, name: `${fileName?.trim() || "Resume"}.${found.mimeType === DOCX_MIME ? "docx" : "pdf"}` };
  }, [firmId, candidateId, resumeId, fileName]);

  const readPage = useCallback(async (isCurrent: () => boolean) => {
    try {
      const missing = await missingAccess(tabId);
      if (isCurrent()) {
        const key = missing?.origins.join() ?? "";
        // Another site, or none: a "no" given on the last one says nothing about this one.
        if (key !== accessKey.current) {
          accessKey.current = key;
          setAccess(missing);
          setIsAccessDenied(false);
        }
        // The last page's review isn't this page's: clear it, so Autofill and Mark applied can't act on it here.
        if (missing) {
          shownRows.current = null;
          setRows(null);
          setReviewedFor(null);
        }
      }
      if (missing) return null;
      return { ...await scanTab(tabId), pending: await undoCount(tabId) };
    } catch (e) {
      if (isCurrent()) setError(explain(PAGE_UNREADABLE, e));
      return null;
    }
  }, [tabId]);

  const showRows = useCallback((next: ReviewRow[]) => {
    shownRows.current = next;
    setRows(next);
  }, []);

  const review = useCallback((fields: TabField[], answers: BankEntry[], justFilled?: ReadonlySet<string>) => {
    const reviewed = withResumeFile(buildReview(fields, answers, job), bank.current?.file ?? null);
    const next = withMemory(reviewed, memory.current, resume.current, justFilled);
    showRows(next);
    const { settled } = memory.current;
    const autofilled = new Map(next.flatMap((row) => {
      const value = settled.get(memoKeyOf(row));
      return value === undefined ? [] : [[row.key, value] as const];
    }));
    rememberRows(formOf(applicationId), next, autofilled);
  }, [applicationId, job, showRows]);

  const scan = useCallback(async (justFilled?: ReadonlySet<string>, reuseBank = false) => {
    // The résumés are still loading: there's nothing to answer from yet.
    if (busy.current || resumeId === undefined) return;
    latestScan.current += 1;
    const run = latestScan.current;
    const isCurrent = () => run === latestScan.current && !busy.current;
    isScanRunning.current = true;
    setScanning(true);
    const held = reuseBank && bank.current?.resumeId === resumeId ? bank.current : null;
    const [answers, file] = held ? [held.entries, held.file] : await Promise.all([loadAnswers(), loadFile()]);
    const page = answers ? await readPage(isCurrent) : null;
    if (answers && page && isCurrent()) {
      try {
        // A page's scans count from one, so a lower count means it loaded afresh.
        const topScan = page.scanIds.get(TOP_FRAME) ?? 0;
        if (topScan < memory.current.lastScan) {
          Object.assign(memory.current, pageMemory());
          setAttachedFile(null);
        }
        memory.current.lastScan = topScan;
        bank.current = { resumeId, entries: answers, file };
        review(page.fields, answers, justFilled);
        setAttachment(file?.name ?? null);
        frames.current = page;
        setSignals(page.signals);
        setBankEmpty(answers.length === 0);
        setAnsweredFrom(resumeId);
        setReviewedFor({ applicationId, candidateId, resumeId });
        setUnreadableFrames(page.unreadableFrames);
        setUndoable(page.pending);
        setError("");
      } catch (e) {
        setError(explain(REVIEW_FAILED, e));
      }
    }
    if (run === latestScan.current) {
      isScanRunning.current = false;
      setScanning(false);
    }
  }, [applicationId, candidateId, resumeId, loadAnswers, loadFile, readPage, review]);
  // The scan for the current résumé, for a click that started before the résumé changed (Allow, while Chrome asks).
  const currentScan = useRef(scan);
  useEffect(() => { currentScan.current = scan; }, [scan]);

  useEffect(() => {
    const first = window.setTimeout(() => void scan(), 0);
    let pending: number | undefined;
    const onNavigated = (details: FrameDetails) => {
      if (details.tabId !== tabId || details.frameId !== 0) return;
      window.clearTimeout(pending);
      pending = window.setTimeout(() => {
        setOutcome(null);
        setUndoNote("");
        void scan();
      }, RESCAN_DELAY_MS);
    };
    chrome.webNavigation.onCompleted.addListener(onNavigated);
    chrome.webNavigation.onHistoryStateUpdated.addListener(onNavigated);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(pending);
      chrome.webNavigation.onCompleted.removeListener(onNavigated);
      chrome.webNavigation.onHistoryStateUpdated.removeListener(onNavigated);
    };
  }, [scan, tabId]);

  /** The BDE's click on Allow: Chrome's own prompt, which needs this click, so the request comes before anything is awaited.
   * Once allowed, the page is scanned as if it had been on the list all along. */
  const allowAccess = useCallback(async () => {
    if (!access || asking.current) return;
    asking.current = true;
    setIsAsking(true);
    try {
      const granted = await requestAccess(access).catch(() => false);
      setIsAccessDenied(!granted);
      if (granted) {
        // Allowed now: the notice goes at once, whatever the scan finds. The scan is the latest one, not the one this
        // click began with: the résumé may have changed while Chrome's prompt was open.
        accessKey.current = "";
        setAccess(null);
        await currentScan.current();
      }
    } finally {
      asking.current = false;
      setIsAsking(false);
    }
  }, [access]);

  /** A look at the form between scans: what the BDE has filled since, and whether fields came or went. The page has no
   * way to message the extension, so the panel asks. */
  const watchForm = useCallback(async () => {
    const canLook = () => !busy.current && !isScanRunning.current && shownRows.current !== null;
    if (!canLook()) return;
    const look = await readTab(tabId, frames.current).catch(() => null);
    if (!look || !canLook()) return;
    if (look.moved) {
      await scan(undefined, true);
      return;
    }
    const shown = shownRows.current!;
    const fields = shown.map(({ field }) => ({ ...field, current: look.values.get(`${field.frameId}:${field.id}`) ?? field.current }));
    if (fields.every(({ current }, index) => current === shown[index]!.field.current)) return;
    try {
      review(fields, bank.current?.entries ?? []);
    } catch (e) {
      setError(explain(REVIEW_FAILED, e));
    }
  }, [review, scan, tabId]);

  useEffect(() => {
    let timer = 0;
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState === "visible") await watchForm();
      if (!stopped) timer = window.setTimeout(() => void tick(), WATCH_MS);
    };
    timer = window.setTimeout(() => void tick(), WATCH_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [watchForm]);

  const check = useMemo(() => checkJob(job, signals), [job, signals]);
  const host = signals ? hostOf(signals.url) : "";
  const needsConfirmation = check.conflict && !confirmedHosts.includes(host);

  const targets = useMemo(() => (rows ?? []).filter((row): row is FillableRow =>
    row.status === "ready" && Boolean(row.write)), [rows]);

  /** Some pages reset a field when a later one changes, so the whole run is checked again once it has settled. */
  const lateFailures = useCallback(async (filled: FillableRow[]) => {
    await new Promise((resolve) => window.setTimeout(resolve, LATE_CHECK_MS));
    const filledFrames = new Set(filled.map(({ field }) => field.frameId));
    let late = 0;
    for (const frameId of filledFrames) {
      const inFrame = filled.filter(({ field }) => field.frameId === frameId);
      const scanId = frames.current.scanIds.get(frameId) ?? 0;
      const ids = inFrame.map(({ field }) => field.id);
      const rejected = await rejectedFields(tabId, frameId, scanId, ids).catch((): string[] => []);
      const flagged = await flaggedFields(tabId, frameId, scanId, ids).catch((): string[] => []);
      inFrame.filter(({ field }) => rejected.includes(field.id) || flagged.includes(field.id)).forEach((row) => {
        memory.current.handedBack.set(memoKeyOf(row), rejected.includes(row.field.id) ? PAGE_RESET : FORM_FLAGGED);
        late += 1;
      });
    }
    return late;
  }, [tabId]);

  /** Shows one field's result as soon as it's known, so the list fills in as the run goes. */
  const showResult = useCallback((key: string, update: (row: ReviewRow) => ReviewRow) => {
    showRows((shownRows.current ?? []).map((row) => (row.key === key ? update(row) : row)));
  }, [showRows]);

  /** Puts a field in the run's list as BenchQ reaches it, or updates it there once its result is known. */
  const track = useCallback((item: RunItem) => {
    setRun((current) => current && {
      ...current,
      items: current.items.some(({ key }) => key === item.key)
        ? current.items.map((entry) => (entry.key === item.key ? item : entry))
        : [...current.items, item],
    });
  }, []);

  /** One pass over `rows`, each field as BenchQ reaches it, then the check once the pass has settled. */
  const fillPass = useCallback(async (rows: FillableRow[]): Promise<Pass> => {
    let failed = 0;
    const filled: FillableRow[] = [];
    let stopped = false;
    for (const row of rows) {
      const { field, write, key } = row;
      const label = fieldLabel(field);
      track({ key, label, status: "filling" });
      const scanId = frames.current.scanIds.get(field.frameId);
      const request = { scanId: scanId ?? 0, fieldId: field.id, current: field.current };
      const fill = write.type === "choice"
        ? fillChoice(tabId, field.frameId, { ...request, search: write.value.split(",")[0]!.trim() }, write.value, write.also)
        : fillField(tabId, field.frameId, { ...request, write });
      const result = scanId === undefined ? STALE : await fill.catch(() => STALE);
      if (result.status === "stale") {
        stopped = true;
        track({ key, label, status: "failed", reason: RUN_STOPPED });
        break;
      }
      if (result.status === "filled") {
        filled.push(row);
        memory.current.filledFrom.set(memoKeyOf(row), resume.current);
        if (write.type === "file") {
          memory.current.attached.set(memoKeyOf(row), write.name);
          setAttachedFile(write.name);
        }
        track({ key, label, status: "filled", value: result.current || row.proposed });
        showResult(key, (item) => ({ ...item, status: "same", field: { ...item.field, current: result.current } }));
      } else {
        const reason = result.reason ?? FAILURE_REASONS[result.status] ?? FAILURE_REASONS.failed!;
        memory.current.handedBack.set(memoKeyOf(row), reason);
        if (result.status === "no-match" && write.type === "choice") memory.current.unmatched.add(memoKeyOf(row));
        track({ key, label, status: "failed", reason });
        showResult(key, (item) => ({ ...item, status: "manual", reason, write: undefined }));
        failed += 1;
      }
    }
    const late = await lateFailures(filled);
    for (const row of filled) {
      const reason = memory.current.handedBack.get(memoKeyOf(row));
      if (reason) track({ key: row.key, label: fieldLabel(row.field), status: "failed", reason });
    }
    return { filled, failed, late, stopped };
  }, [lateFailures, showResult, tabId, track]);

  /** Waits for the form to go still once the résumé is on it: a site that reads the file fills fields of its own, and
   * the answers go on after that, never under it (07 Q50). */
  const settle = useCallback(async ({ every, least, still: needed, most } = SETTLE) => {
    let last: string | null = null;
    let still = 0;
    for (let look = 1; look <= most; look += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, every));
      const read = await readTab(tabId, frames.current).catch(() => null);
      const now = read ? JSON.stringify([read.moved, [...read.values]]) : "";
      still = now === last ? still + 1 : 0;
      last = now;
      if (look >= least && still >= needed) return;
    }
  }, [tabId]);

  /** Fills `first`, then, when `passes` allows, the questions its answers brought out: fields that weren't on the form
   * before the run. A field that was there keeps whatever the first pass left it. The résumé's file goes on before
   * anything else: what the site reads from it is then the site's, and the answers replace it (07 Q50). */
  const fillRows = useCallback(async (first: FillableRow[], passes: number) => {
    if (busy.current || needsConfirmation || first.length === 0) return;
    busy.current = true;
    setOutcome(null);
    setUndoNote("");
    setRun({ total: first.length, items: [] });
    setFilling(true);
    const total: Outcome = { filled: 0, handedBack: 0, stopped: false };
    const known = new Set((shownRows.current ?? []).map(memoKeyOf));
    let batch = first;
    const files = first.filter(isAttachment);
    if (files.length > 0) {
      const [file] = files;
      setStep(`Attaching ${file!.write.type === "file" ? file!.write.name : "the resume"}…`);
      const { filled, failed, late, stopped } = await fillPass(files);
      total.filled += filled.length - late;
      total.handedBack += failed + late;
      // An upload the page swapped out is the BDE's to change; it doesn't stop the answers (07 Q24, Q50).
      if (stopped) {
        for (const row of files.filter((file) => !filled.includes(file))) {
          memory.current.handedBack.set(memoKeyOf(row), UPLOAD_GONE);
          track({ key: row.key, label: fieldLabel(row.field), status: "failed", reason: UPLOAD_GONE });
          total.handedBack += 1;
        }
      }
      if (filled.length > 0) {
        setStep(STEP_READING);
        await settle();
      }
      setStep(null);
      // A look that counts what changed meanwhile as BenchQ's doing: a field the site filled from the file is no edit
      // of the BDE's, so its answer still goes on.
      busy.current = false;
      await scan(new Set(filled.map(memoKeyOf).filter((key) => !memory.current.handedBack.has(key))));
      busy.current = true;
      batch = (shownRows.current ?? []).filter((row): row is FillableRow => row.status === "ready" && Boolean(row.write) && !isAttachment(row as FillableRow));
      const count = batch.length;
      setRun((current) => current && { ...current, total: files.length + count });
    }
    for (let pass = 0; pass < passes && batch.length > 0; pass += 1) {
      const count = batch.length;
      if (pass > 0) setRun((current) => current && { ...current, total: current.total + count });
      batch.forEach((row) => known.add(memoKeyOf(row)));
      const { filled, failed, late, stopped } = await fillPass(batch);
      total.filled += filled.length - late;
      total.handedBack += failed + late;
      total.stopped = stopped;
      // A fresh look at the form, which also shows what the answers brought out.
      busy.current = false;
      await scan(new Set(filled.map(memoKeyOf).filter((key) => !memory.current.handedBack.has(key))));
      busy.current = true;
      if (stopped) break;
      batch = (shownRows.current ?? []).filter((row): row is FillableRow => row.status === "ready" && Boolean(row.write) && !known.has(memoKeyOf(row)));
    }
    busy.current = false;
    setFilling(false);
    setRun(null);
    setOutcome(total);
  }, [fillPass, needsConfirmation, scan, settle, track]);

  /** Takes back BenchQ's fills from another résumé that the picked one doesn't answer, as Undo would, so the form holds
   * nothing of the old résumé; a field the BDE has changed since stays as it is. */
  const takeBackStale = useCallback(async (stale: ReviewRow[]) => {
    busy.current = true;
    setStep(STEP_CLEARING);
    for (const row of stale) {
      const scanId = frames.current.scanIds.get(row.field.frameId);
      const target = { scanId: scanId ?? 0, fieldId: row.field.id };
      const isBack = scanId !== undefined && await takeBackField(tabId, row.field.frameId, target).catch(() => false);
      if (!isBack) continue;
      const key = memoKeyOf(row);
      memory.current.filledFrom.delete(key);
      memory.current.settled.delete(key);
      memory.current.attached.delete(key);
    }
    setAttachedFile([...memory.current.attached.values()].at(-1) ?? null);
    busy.current = false;
    // What changed is BenchQ's doing, so none of it counts as the BDE's edit.
    await scan(new Set());
  }, [scan, tabId]);

  /** Takes the files BenchQ attached for another résumé off the page, through the page's own remove control, so the
   * picked résumé's file replaces them instead of being ignored beside them (Greenhouse shows a taken file as a chip and
   * ignores a new one put under it). Once one came off, the page gets to go still and is looked at again. `keep`: the
   * picked résumé's file, left where it is. A page with no remove control keeps its file, and the new one goes over it. */
  const removeOldFiles = useCallback(async (keep: string | null) => {
    const old = [...memory.current.attached.entries()].filter(([, name]) => name !== keep);
    if (old.length === 0) return;
    busy.current = true;
    setStep(STEP_REMOVING);
    let isRemoved = false;
    for (const [key, name] of old) {
      if (!await removeFileOnPage(tabId, name).catch(() => false)) continue;
      memory.current.attached.delete(key);
      memory.current.settled.delete(key);
      memory.current.filledFrom.delete(key);
      isRemoved = true;
    }
    if (isRemoved) {
      setAttachedFile([...memory.current.attached.values()].at(-1) ?? null);
      await settle(SETTLE_AFTER_REMOVE);
    }
    busy.current = false;
    // What changed is BenchQ's doing, so none of it counts as the BDE's edit.
    if (isRemoved) await scan(new Set());
  }, [scan, settle, tabId]);

  /** Fills the form from the picked résumé. After a change of résumé, the file BenchQ attached for the old one comes off
   * first, then the old one's fills the new one doesn't answer go back, then the new one's answers and file go on. */
  const autofill = useCallback(async () => {
    if (busy.current || needsConfirmation) return;
    try {
      await removeOldFiles(bank.current?.file?.name ?? null);
      const stale = (shownRows.current ?? []).filter((row) => row.isStale);
      if (stale.length > 0) await takeBackStale(stale);
      setStep(null);
      await fillRows((shownRows.current ?? []).filter(isFillable), PASSES);
    } finally {
      setStep(null);
    }
  }, [fillRows, needsConfirmation, removeOldFiles, takeBackStale]);

  /** Writes the saved answers over values the form held before BenchQ looked, for the rows the BDE chose. */
  const replace = useCallback((chosen: ReviewRow[]) =>
    fillRows(chosen.filter((row): row is FillableRow => row.status === "kept" && Boolean(row.write)), 1), [fillRows]);

  /** Fills a field with one of the saved answers suggested for it, which the BDE picked (Q26). It counts as BenchQ's
   * fill, so Undo takes it back too. An answer that doesn't fit the field says why instead. */
  const fillWith = useCallback(async (row: ReviewRow, entry: BankEntry) => {
    const picked = suggestedRow(row, entry);
    if (picked.status === "ready" && picked.write) {
      await fillRows([picked as FillableRow], 1);
      return;
    }
    if (picked.status === "manual") showResult(row.key, (item) => ({ ...item, reason: picked.reason }));
  }, [fillRows, showResult]);

  /** A dropdown's options, for a row Autofill found no clear option for, so the BDE can choose one in the panel. */
  const listOptions = useCallback(async ({ field }: ReviewRow): Promise<string[] | null> => {
    const scanId = frames.current.scanIds.get(field.frameId);
    if (scanId === undefined || busy.current) return null;
    return listChoices(tabId, field.frameId, { scanId, fieldId: field.id, current: field.current, search: "" }).catch(() => null);
  }, [tabId]);

  /** Picks the option the BDE chose in the panel. It counts as BenchQ's fill, so Undo takes it back too. */
  const choose = useCallback(async (row: ReviewRow, label: string) => {
    const { field } = row;
    const scanId = frames.current.scanIds.get(field.frameId);
    if (busy.current || scanId === undefined) return;
    busy.current = true;
    const request = { scanId, fieldId: field.id, current: field.current, search: label };
    const result = await chooseChoice(tabId, field.frameId, request, label).catch(() => STALE);
    const key = memoKeyOf(row);
    if (result.status === "filled") {
      memory.current.handedBack.delete(key);
      memory.current.unmatched.delete(key);
    }
    busy.current = false;
    await scan(result.status === "filled" ? new Set([key]) : undefined);
  }, [scan, tabId]);

  /** Takes the BDE to a row's field on the form. If the page has moved on, a fresh review shows what's there now. */
  const goToField = useCallback(async ({ field }: ReviewRow) => {
    const scanId = frames.current.scanIds.get(field.frameId);
    const found = scanId !== undefined
      && await focusField(tabId, field.frameId, { scanId, fieldId: field.id }).catch(() => false);
    if (!found) await scan();
  }, [scan, tabId]);

  const undo = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setOutcome(null);
    try {
      const { restored, kept, skipped } = await undoFills(tabId);
      const notes = [`Restored ${plural(restored, "field")}.`];
      if (kept > 0) notes.push(`Kept ${plural(kept, "field")} you changed.`);
      if (skipped > 0) notes.push(`${plural(skipped, "dropdown")} couldn't be cleared, so change that on the page.`);
      setUndoNote(notes.join(" "));
    } catch {
      setUndoNote("Could not undo: this page has changed.");
    }
    memory.current.settled.clear();
    memory.current.filledFrom.clear();
    memory.current.attached.clear();
    setAttachedFile(null);
    busy.current = false;
    await scan(new Set());
  }, [scan, tabId]);

  /** The form as it stands, for Mark applied. A page that has gone leaves what BenchQ last saw on it, and one stuck on an
   * alert() never answers, which mustn't hold up the job. */
  const finalForm = useCallback(async (): Promise<AppliedForm> => {
    await Promise.race([watchForm(), new Promise((resolve) => window.setTimeout(resolve, LAST_LOOK_MS))]);
    return appliedForm(formOf(applicationId));
  }, [applicationId, watchForm]);

  return {
    rows, scanning, error, needsAccess: access, isAccessDenied, isAsking, allowAccess, bankEmpty, unreadableFrames, filling, run, outcome, undoable, undoNote, check, host, answeredFrom, reviewedFor, attachment, attachedFile, step,
    needsConfirmation, fillCount: targets.length, staleCount: (rows ?? []).filter((row) => row.isStale).length, rescan: scan, autofill, replace, fillWith, listOptions, choose, undo, goToField, finalForm,
  };
}
