import type { SaveOffer } from "./save-answer";

/** What the side panel, the background worker and the page script say to each other. Types only: the page script
 * must stay free of shared runtime code (vite.config.ts checks it). */

/** `key`: what a résumé's fixed question asks (docs/02 §8.1), so it finds a form's field by that, not by its wording
 * (`answer-keys.ts`). A saved question has none. */
export type BankEntry = { id: string; question: string; answer: string; category: string; key?: string };

export type FieldKind =
  | "text" | "email" | "tel" | "url" | "number" | "date" | "textarea" | "select" | "radio" | "checkbox"
  | "combobox" | "password" | "file" | "custom";

export type FieldOption = { id: string; label: string };

/** What the engine reads about a field beyond its label. */
export type FieldClues = {
  name: string;
  id: string;
  placeholder: string;
  ariaLabel: string;
  nearbyText: string;
  sectionHeading: string;
  className: string;
  dataAttrs: string;
};

export type ScannedField = {
  id: string;
  kind: FieldKind;
  label: string;
  hints: string;
  clues: FieldClues;
  autocomplete: string;
  required: boolean;
  current: string;
  options: FieldOption[];
  maxLength: number | null;
  inAccountForm: boolean;
  /** The same control keeps this id across scans of one page load, so what the panel remembers about it stays with it
   * when fields come or go above it. */
  stableId?: string;
};

export type TabField = ScannedField & { frameId: number; pageUrl: string };

export type PageSignals = {
  url: string;
  title: string;
  heading: string;
  siteName: string;
  posting: { title: string; company: string } | null;
};

export type FrameScan = { scanId: number; url: string; fields: ScannedField[]; signals: PageSignals | null };

/** A frame's fields as they stand, by field id. `moved`: the form has changed shape, so a scan is due. */
export type FrameRead = { scanId: number; values: Record<string, string>; moved: boolean };

export type FieldWrite =
  | { type: "text"; value: string }
  | { type: "option"; optionId: string }
  | { type: "check"; checked: boolean; optionIds?: string[] }
  /** `also`: other wordings of the answer, tried in turn when the dropdown has no option for `value`, like the status a
   * candidate's authorization answers come to. */
  | { type: "choice"; value: string; also?: string[] }
  /** The picked résumé's own file, for the form's résumé upload (07 Q49–Q52). `data` is the file in base64, as a
   * message to the page carries it. */
  | { type: "file" } & ResumeFile;

/** A résumé's file as the panel holds it: its name on the form, its type and its bytes in base64. */
export type ResumeFile = { name: string; mimeType: string; data: string };

export type FillRequest = { scanId: number; fieldId: string; write: FieldWrite; current: string };
export type FillResult = { status: "filled" | "failed" | "stale" | "changed" | "no-match"; current: string; reason?: string };
export type UndoResult = { restored: number; kept: number; skipped: number };

/** A custom dropdown's options exist only once it's open, so its answer is matched at fill time. */
export type ChoiceRequest = { scanId: number; fieldId: string; current: string; search: string };
export type PickRequest = ChoiceRequest & { optionId: string };
/** `multiple`: the dropdown keeps several choices, like a "mark all that apply" list. */
export type ChoiceList = { status: "open"; options: FieldOption[]; multiple?: boolean } | { status: "empty" | "stale" | "changed" };
export type FieldTarget = { scanId: number; fieldId: string };

/** What the page script exposes in its isolated world. */
/** A job as its page shows it, for adding it to a candidate's jobs (the add-job plan, 2026-11-11): `description` as the
 * page wrote it (HTML from its JobPosting data, else its main text). */
/** `isJobPage`: the page is a job's page (`page/job.ts`); on any other page the rest is empty. */
export type PageJob = {
  title: string; company: string; description: string; location: string | null; url: string; isJobPage: boolean;
  /** The codes the page gives its job (its JobPosting identifier, a "Job ID:" line), lowercase, and the other links it
   * gives itself (canonical, og:url), for knowing a job the candidate already has. */
  ids?: string[]; links?: string[];
};

export type PageApi = {
  version: string;
  readJob(): PageJob;
  /** Clicks the form's "Add another" for a kind of history entry (#132): whether one was found. */
  addEntry(kind: "education" | "work"): boolean;
  scan(): Promise<FrameScan>;
  read(): FrameRead | null;
  fill(request: FillRequest): Promise<FillResult>;
  openChoices(request: ChoiceRequest): Promise<ChoiceList>;
  searchChoices(request: ChoiceRequest): Promise<ChoiceList>;
  pickChoice(request: PickRequest): Promise<FillResult>;
  closeChoices(request: ChoiceRequest): boolean;
  rejected(scanId: number, fieldIds: string[]): string[];
  flagged(scanId: number, fieldIds: string[]): Promise<string[]>;
  focusField(target: FieldTarget): boolean;
  takeBack(target: FieldTarget): Promise<boolean>;
  removeFile(name: string): Promise<boolean>;
  undo(): Promise<UndoResult>;
  undoCount(): number;
};

/** `source`: where BenchQ found the job (`jobs.source`: `jobspy_linkedin`, `direct`…), for "How did you hear about
 * us?". A connection made before it was kept has none. */
export type JobSummary = { title: string | null; company: string | null; url: string; source?: string | null };

/** A tab connected to a saved application: ids and the job's summary, never the candidate's answers. */
export type Connection = {
  tabId: number;
  applicationId: string;
  candidateId: string;
  userId: string;
  job: JobSummary;
  confirmedHosts: string[];
};

export type NewConnection = Omit<Connection, "tabId" | "confirmedHosts">;

export type PanelMessage =
  | { type: "open-job"; connection: NewConnection }
  /** Connect a tab that already shows the job (one the BDE opened by hand), instead of opening it again. */
  | { type: "connect-tab"; connection: NewConnection; tabId: number }
  | { type: "disconnect-tab"; tabId: number }
  | { type: "disconnect-job"; applicationId: string }
  | { type: "confirm-host"; tabId: number; host: string }
  | { type: "clear-connections" };

export type PanelReply = { ok: true; tabId?: number } | { ok: false };

/** The keyboard shortcuts (manifest `commands`), which the worker passes on to the panel with the tab they were pressed
 * on: the panel acts only for its own job's tab. */
export type ShortcutCommand = "run-autofill" | "mark-applied";
export type ShortcutMessage = { type: "shortcut"; command: ShortcutCommand; tabId?: number };

export type ReviewRow = {
  key: string;
  field: TabField;
  /** `kept`: the form held a different value before BenchQ first looked, so Autofill leaves it unless the BDE replaces it. */
  status: "ready" | "same" | "manual" | "blocked" | "kept";
  reason?: string;
  proposed?: string;
  write?: FieldWrite;
  /** The saved question and answer behind the value. */
  source?: BankEntry;
  alternatives?: string[];
  /** Never kept in the form saved with the application, whoever filled it in. */
  isUnsaved?: boolean;
  /** A dropdown Autofill opened but found no clear option in: the BDE can pick one from its options in the panel. */
  canChoose?: boolean;
  /** BenchQ filled it from another résumé, it's unchanged since, and the picked résumé doesn't answer it: Autofill takes
   * it back, so the old résumé's value doesn't stay on the form. */
  isStale?: boolean;
  /** BenchQ filled it from another résumé than the picked one, and it's unchanged since: Autofill replaces it or takes it
   * back. While a switch of résumé refills the form, the progress doesn't count it, so the count starts afresh. */
  isOldFill?: boolean;
  /** An answer the BDE typed while BenchQ watched, which they can keep for next time (07 Q58): what saving it would do,
   * or "saved" once it's kept. */
  saveOffer?: SaveOffer | "saved";
  /** For a question no saved answer clearly matches: the closest of the candidate's own screening answers, which the
   * BDE can use with a click. Never filled on their own. */
  suggestions?: BankEntry[];
};

/** One field of an Autofill run, as the panel lists it while the run goes: the value it took, or why it didn't. */
export type RunItem = { key: string; label: string; status: "filling" | "filled" | "failed"; value?: string; reason?: string };
export type AutofillRun = { total: number; items: RunItem[] };

/** `applications.form_data`: one field as the employer's form last held it, and who put it there. */
export type AppliedField = { label: string; value: string; required: boolean; source: "autofill" | "bde" };
export type AppliedForm = { fields: AppliedField[] };

export type JobCheck = { conflict: boolean; detected: string };
