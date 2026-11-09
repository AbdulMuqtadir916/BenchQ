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
  | { type: "choice"; value: string; also?: string[] };

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
export type PageApi = {
  version: string;
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
};

/** One field of an Autofill run, as the panel lists it while the run goes: the value it took, or why it didn't. */
export type RunItem = { key: string; label: string; status: "filling" | "filled" | "failed"; value?: string; reason?: string };
export type AutofillRun = { total: number; items: RunItem[] };

/** `applications.form_data`: one field as the employer's form last held it, and who put it there. */
export type AppliedField = { label: string; value: string; required: boolean; source: "autofill" | "bde" };
export type AppliedForm = { fields: AppliedField[] };

export type JobCheck = { conflict: boolean; detected: string };
