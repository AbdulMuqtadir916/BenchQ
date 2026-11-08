import { optionFor, pickOneReason } from "./options";
import { racePartsFor } from "./race";
import type {
  ChoiceList, ChoiceRequest, FieldOption, FieldTarget, FillRequest, FillResult, FrameRead, FrameScan, PageApi, PageSignals, TabField,
  UndoResult,
} from "./types";

/** The side panel's calls into a tab's page script. Each runs in the frames it names and returns their answers. */

const PAGE_SCRIPT = "page.js";
const STALE: FillResult = { status: "stale", current: "" };

export type TabScan = {
  fields: TabField[];
  scanIds: Map<number, number>;
  signals: PageSignals | null;
  unreadableFrames: number;
};

/** Every field's value now, by `frameId:fieldId`. `moved`: the page no longer matches its last scan. */
export type TabRead = { values: Map<string, string>; moved: boolean };

type PageMethod = Exclude<keyof PageApi, "version">;

const MAIN_FRAME = 0;

/** Runs inside the page, from its source text alone, so it can't use anything from this module. A failure comes back
 * as a value, so the panel sees the reason whichever frame it came from. */
async function callPage(method: PageMethod, args: unknown[]) {
  const page = (globalThis as { __benchqAutofill?: Record<string, (...args: unknown[]) => unknown> }).__benchqAutofill;
  if (!page) return null;
  try {
    return await page[method]!(...args);
  } catch (error) {
    return { pageError: String(error) };
  }
}

const pageError = (result: unknown) => (result as { pageError?: string } | null | undefined)?.pageError;

/** Each frame's answer. A frame that fails is left out, unless it's the page itself. */
async function inFrames<T>(target: InjectionTarget, method: PageMethod, args: unknown[]) {
  const results = await chrome.scripting.executeScript({ target, func: callPage, args: [method, args] });
  const failed = results.find(({ frameId, result }) => frameId === MAIN_FRAME && pageError(result));
  if (failed) throw new Error(pageError(failed.result));
  return results.flatMap(({ frameId, result }) => (result === null || result === undefined || pageError(result)
    ? [] : [{ frameId, result: result as T }]));
}

/** The web frames that gave no answer. */
async function countUnreadable(tabId: number, answers: { frameId: number }[]) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  const answered = new Set(answers.map(({ frameId }) => frameId));
  return (frames ?? []).filter(({ frameId, url }) => /^https?:/.test(url) && !answered.has(frameId)).length;
}

export async function scanTab(tabId: number): Promise<TabScan> {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [PAGE_SCRIPT] });
  const scans = await inFrames<FrameScan>({ tabId, allFrames: true }, "scan", []);
  return {
    fields: scans.flatMap(({ frameId, result }) => result.fields.map((field) => ({ ...field, frameId, pageUrl: result.url }))),
    scanIds: new Map(scans.map(({ frameId, result }) => [frameId, result.scanId])),
    signals: scans.find(({ result }) => result.signals)?.result.signals ?? null,
    unreadableFrames: await countUnreadable(tabId, scans),
  };
}

/** A light look at a scanned tab, between scans. A frame that came, went or scanned again means the form has moved on. */
export async function readTab(tabId: number, { scanIds, unreadableFrames }: Pick<TabScan, "scanIds" | "unreadableFrames">): Promise<TabRead> {
  const reads = await inFrames<FrameRead>({ tabId, allFrames: true }, "read", []);
  const isScanned = ({ frameId, result }: { frameId: number; result: FrameRead }) => !result.moved && result.scanId === scanIds.get(frameId);
  return {
    values: new Map(reads.flatMap(({ frameId, result }) => Object.entries(result.values).map(([id, value]) => [`${frameId}:${id}`, value]))),
    moved: reads.length !== scanIds.size || !reads.every(isScanned) || await countUnreadable(tabId, reads) !== unreadableFrames,
  };
}

export async function fillField(tabId: number, frameId: number, request: FillRequest): Promise<FillResult> {
  const [answer] = await inFrames<FillResult>({ tabId, frameIds: [frameId] }, "fill", [request]);
  return answer?.result ?? STALE;
}

/** The parts of an answer a dropdown that keeps several choices gets one by one: "South Asian, White". */
const PARTS = /\s*(?:[,;]|\band\b)\s*/;

type Target = { tabId: number; frameIds: number[] };

const askList = async (target: Target, method: "openChoices" | "searchChoices", request: ChoiceRequest) =>
  (await inFrames<ChoiceList>(target, method, [request]))[0]?.result;

/** Picks the option with this wording: the list opens, or is searched for it when it shows only some options. */
async function pickByLabel(target: Target, request: ChoiceRequest, label: string): Promise<FillResult> {
  const list = await askList(target, "openChoices", request);
  if (!list || list.status === "stale") return STALE;
  if (list.status === "changed") return { status: "changed", current: "" };
  let option = list.status === "open" ? list.options.find((item) => item.label === label) : undefined;
  if (!option && list.status === "open") {
    const searched = await askList(target, "searchChoices", { ...request, search: label });
    option = searched?.status === "open" ? searched.options.find((item) => item.label === label) : undefined;
  }
  if (!option) {
    await inFrames<boolean>(target, "closeChoices", [request]);
    return { status: "no-match", current: "" };
  }
  const [picked] = await inFrames<FillResult>(target, "pickChoice", [{ ...request, optionId: option.id }]);
  return picked?.result ?? STALE;
}

/** A dropdown that keeps several choices gets each part of the answer, all of them or none: every part has to find its
 * option before anything is picked. */
async function pickEach(target: Target, request: ChoiceRequest, options: FieldOption[], parts: string[]): Promise<FillResult> {
  const labels: string[] = [];
  for (const part of parts) {
    let shown = options;
    let optionId = optionFor(part, shown);
    if (!optionId) {
      const searched = await askList(target, "searchChoices", { ...request, search: part });
      shown = searched?.status === "open" ? searched.options : [];
      optionId = optionFor(part, shown);
    }
    const label = shown.find(({ id }) => id === optionId)?.label;
    if (!label) {
      await inFrames<boolean>(target, "closeChoices", [request]);
      return { status: "no-match", current: "" };
    }
    labels.push(label);
  }
  await inFrames<boolean>(target, "closeChoices", [request]);
  let result: FillResult = { status: "filled", current: request.current };
  for (const label of labels) {
    result = await pickByLabel(target, { ...request, current: result.current }, label);
    if (result.status !== "filled") return result;
  }
  return result;
}

/** A dropdown's options as it shows them, for the BDE to choose from in the panel. The list closes again untouched. */
export async function listChoices(tabId: number, frameId: number, request: ChoiceRequest): Promise<string[] | null> {
  const target = { tabId, frameIds: [frameId] };
  const list = await askList(target, "openChoices", request);
  await inFrames<boolean>(target, "closeChoices", [request]);
  return list?.status === "open" ? list.options.map(({ label }) => label) : null;
}

/** Picks the option the BDE chose in the panel, by its wording. */
export const chooseChoice = (tabId: number, frameId: number, request: ChoiceRequest, label: string) =>
  pickByLabel({ tabId, frameIds: [frameId] }, request, label);

/** A custom dropdown: open it, match the answer against what it offers, then pick. The matching runs here because the
 * page script can't share code with the panel. A list can show only some of its options, like a lookup's suggestions
 * or a long list's first page, so an answer not on show gets one search, in a dropdown that takes typing. `also` are
 * other wordings of the answer, tried in turn. A dropdown that keeps several choices gets each part of the answer. An
 * answer with no clear option closes the list again, untouched. */
export async function fillChoice(tabId: number, frameId: number, request: ChoiceRequest, answer: string, also: string[] = []): Promise<FillResult> {
  const target = { tabId, frameIds: [frameId] };
  const ask = (method: "openChoices" | "searchChoices") => askList(target, method, request);
  const fits = (list?: ChoiceList) => (list?.status === "open"
    ? [answer, ...also].map((wording) => optionFor(wording, list.options)).find(Boolean) ?? null : null);
  const list = await ask("openChoices");
  if (!list || list.status === "stale") return STALE;
  if (list.status === "changed") return { status: "changed", current: "" };
  if (list.status === "open" && list.multiple) {
    const parts = (racePartsFor(answer, list.options) ?? answer.split(PARTS)).map((part) => part.trim()).filter(Boolean);
    if (parts.length > 1) return pickEach(target, request, list.options, parts);
  }
  const optionId = fits(list) ?? (list.status === "open" ? fits(await ask("searchChoices")) : null);
  if (!optionId) {
    await inFrames<boolean>(target, "closeChoices", [request]);
    const reason = list.status === "open" ? pickOneReason(answer, list.options) : null;
    return reason ? { status: "no-match", current: "", reason } : { status: "no-match", current: "" };
  }
  const [picked] = await inFrames<FillResult>(target, "pickChoice", [{ ...request, optionId }]);
  return picked?.result ?? STALE;
}

export async function rejectedFields(tabId: number, frameId: number, scanId: number, fieldIds: string[]): Promise<string[]> {
  const [answer] = await inFrames<string[]>({ tabId, frameIds: [frameId] }, "rejected", [scanId, fieldIds]);
  return answer?.result ?? [];
}

export async function flaggedFields(tabId: number, frameId: number, scanId: number, fieldIds: string[]): Promise<string[]> {
  const [answer] = await inFrames<string[]>({ tabId, frameIds: [frameId] }, "flagged", [scanId, fieldIds]);
  return answer?.result ?? [];
}

export async function focusField(tabId: number, frameId: number, target: FieldTarget): Promise<boolean> {
  const [answer] = await inFrames<boolean>({ tabId, frameIds: [frameId] }, "focusField", [target]);
  return answer?.result ?? false;
}

export async function undoFills(tabId: number): Promise<UndoResult> {
  const answers = await inFrames<UndoResult>({ tabId, allFrames: true }, "undo", []);
  return answers.reduce((total, { result }) => ({
    restored: total.restored + result.restored, kept: total.kept + result.kept, skipped: total.skipped + result.skipped,
  }), { restored: 0, kept: 0, skipped: 0 });
}

export async function undoCount(tabId: number): Promise<number> {
  const answers = await inFrames<number>({ tabId, allFrames: true }, "undoCount", []);
  return answers.reduce((total, { result }) => total + result, 0);
}
