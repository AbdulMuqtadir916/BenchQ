import type { ChoiceList, ChoiceRequest, FieldTarget, FieldWrite, FillRequest, FillResult, PickRequest, UndoResult } from "../autofill/types";
import { clearList, closeList, isMultiple, openList, pickOption, searchList } from "./choice";
import { fireEvents, pause, setText } from "./events";
import { ariaChecked, collapse, isAriaChoice, isOn, isVisible, textOf, uploadBoxes } from "./labels";
import { readCurrent, type Entry, type Registry } from "./scan";

const SETTLE_MS = 80;
const STALE: FillResult = { status: "stale", current: "" };
const PHONE_LIKE = /^\+?[\d\s().-]{7,}$/;
// design.md's focus ring by value: our tokens don't exist on an employer's page.
const RING: Keyframe[] = [
  { outline: "2px solid #4264e9", outlineOffset: "3px" },
  { outline: "2px solid transparent", outlineOffset: "3px" },
];
const RING_MS = 1200;

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** A field's whole state: its value, which of its choices are checked, what a custom dropdown shows, or an upload's
 * files. */
type Snapshot = { value: string } | { checked: boolean[] } | { choice: string } | { files: File[] };

type Filled = { scanId: number; entry: Entry; write: FieldWrite; before: Snapshot; after: Snapshot };

function setChecked(input: HTMLInputElement, checked: boolean) {
  // An option of a list box that keeps several choices: selected or not, and its list says it changed.
  if (input.tagName === "OPTION") {
    const option = input as unknown as HTMLOptionElement;
    if (option.selected !== checked) {
      option.selected = checked;
      fireEvents(option.closest("select") ?? option);
    }
    return;
  }
  // A styled choice has no `checked` to set: a click is how a person turns it on or off.
  if (isAriaChoice(input)) {
    if (ariaChecked(input) !== checked) pickOption(input);
    return;
  }
  if (input.checked === checked) return;
  if (checked || input.type === "checkbox") {
    input.click();
    return;
  }
  input.checked = false;
  fireEvents(input);
}

/** An upload takes files only as a list the browser made: a DataTransfer's. Its change event is how the site sees it. */
function setFiles(input: HTMLInputElement, files: File[]) {
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  input.files = transfer.files;
  fireEvents(input);
}

const fileOf = ({ name, mimeType, data }: FieldWrite & { type: "file" }) =>
  new File([Uint8Array.from(atob(data), (char) => char.charCodeAt(0))], name, { type: mimeType });

/** A control that takes a file off an upload, by its words or its label: "Remove", "Delete", an ×. */
const REMOVE_CONTROL = /\b(remove|delete|clear|discard)\b|^[×✕✖x]$/i;
const controlWords = (element: HTMLElement) =>
  collapse(`${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("title") ?? ""} ${textOf(element)}`);

const ANY_FILE_NAME = /\S\.(?:pdf|docx?|rtf|odt|txt)\b/i;

/** Whether `box` shows a file other than `name`: then it's wider than that file's chip, and its controls may be
 * another file's. */
function showsOtherFile(box: HTMLElement, name: string): boolean {
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = collapse(node.textContent ?? "");
    if (ANY_FILE_NAME.test(text) && !text.includes(name)) return true;
  }
  return false;
}

/** The elements whose text names a file the page took: the chips it shows for it (the name, perhaps with its size). */
function chipsNamed(name: string): HTMLElement[] {
  const chips: HTMLElement[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = collapse(node.textContent ?? "");
    const parent = node.parentElement;
    if (parent && text.includes(name) && text.length <= name.length + 40 && isVisible(parent) && !chips.includes(parent)) chips.push(parent);
  }
  return chips;
}

/** Which of `chips` shows the file BenchQ put on `uploads`: the one in the nearest box an upload sits in, the way the
 * scan reads an upload's file (07 Q53). Once the page has swapped those uploads out, the only chip with the name. A
 * name alone doesn't say whose file it is, so two chips that can't be told apart are both left. */
function ownChip(uploads: HTMLInputElement[], chips: HTMLElement[]): HTMLElement | null {
  const connected = uploads.filter((upload) => upload.isConnected);
  if (connected.length === 0) return chips.length === 1 ? chips[0]! : null;
  for (const upload of connected) {
    for (const box of uploadBoxes(upload)) {
      const inBox = chips.filter((chip) => box.contains(chip));
      if (inBox.length > 0) return inBox.length === 1 ? inBox[0]! : null;
    }
  }
  return null;
}

function checkTargets(entry: Entry, write: FieldWrite & { type: "check" }) {
  return write.optionIds?.map((id) => entry.options.get(id)) ?? [entry.controls[0]];
}

function apply(entry: Entry, write: FieldWrite) {
  const control = entry.controls[0] as Control;
  if (write.type === "text") setText(control as HTMLInputElement, write.value);
  else if (write.type === "file") setFiles(control as HTMLInputElement, [fileOf(write)]);
  else if (write.type === "check") {
    checkTargets(entry, write).forEach((target) => setChecked(target as HTMLInputElement, write.checked));
  } else if (write.type === "option") {
    const target = entry.options.get(write.optionId);
    if (target?.tagName === "OPTION") {
      (target as HTMLOptionElement).selected = true;
      fireEvents(control);
    } else if (target) setChecked(target as HTMLInputElement, true);
  }
}

/** A form's own mask can reformat a number or put a country code in front of it: it's the same number. */
function samePhone(left: string, right: string) {
  const a = left.replace(/\D/g, "");
  const b = right.replace(/\D/g, "");
  return a.length >= 7 && b.length >= 7 && (a.endsWith(b) || b.endsWith(a));
}

const compact = (text: string) => text.toLowerCase().replace(/[^a-z0-9+]/g, "");

/** A dropdown can show less than its option said: "+1" for "United States +1". */
function sameChoice(shown: string, label: string) {
  const a = compact(shown);
  const b = compact(label);
  return Boolean(a && b) && (a.includes(b) || b.includes(a));
}

/** A form's mask can reformat what it's given: "11/20/2026" as "11-20-2026", "95000" as "95,000", "tx" as "TX". The
 * same letters and digits in the same order are the same value. */
function sameValue(shown: string, wanted: string) {
  const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
  return plain(shown) !== "" && plain(shown) === plain(wanted);
}

function accepted(entry: Entry, write: FieldWrite): boolean {
  const control = entry.controls[0] as HTMLInputElement;
  if (write.type === "choice") return sameChoice(readCurrent(entry), write.value);
  if (write.type === "file") return control.files?.length === 1 && control.files[0]!.name === write.name;
  if (write.type === "text") {
    const value = control.value.trim();
    const wanted = write.value.trim();
    return value === wanted || (PHONE_LIKE.test(wanted) && samePhone(value, wanted)) || sameValue(value, wanted);
  }
  if (write.type === "check") {
    return checkTargets(entry, write).every((target) => target !== undefined && isOn(target) === write.checked);
  }
  const target = entry.options.get(write.optionId);
  return target?.tagName === "OPTION" ? (target as HTMLOptionElement).selected : isOn(target);
}

/** The form's own verdict on a value: it marked the control invalid, or the browser's checks fail it. A form judges
 * radios and checkboxes as a group, so one control says nothing, and a custom dropdown's search box is empty once
 * picked, so only the form's mark counts there. */
function isFlagged({ controls, field }: Entry): boolean {
  if (field.kind === "radio" || field.kind === "checkbox") return false;
  const control = controls[0] as HTMLInputElement;
  if (control.getAttribute("aria-invalid") === "true") return true;
  return field.kind !== "combobox" && control.validity?.valid === false;
}

/** What the BDE can see of a control: a styled file upload hides its input inside whatever wraps it. */
function visiblePart(control: HTMLElement): HTMLElement {
  let element = control;
  while (!isVisible(element) && element.parentElement) element = element.parentElement;
  return element;
}

function snapshot(entry: Entry): Snapshot {
  if (entry.field.kind === "combobox") return { choice: readCurrent(entry) };
  if (entry.controls[0]!.tagName === "OPTION") return { checked: entry.controls.map((option) => isOn(option)) };
  if (isAriaChoice(entry.controls[0]!)) return { checked: entry.controls.map(ariaChecked) };
  const inputs = entry.controls as HTMLInputElement[];
  const first = inputs[0]!;
  if (first.type === "radio" || first.type === "checkbox") return { checked: inputs.map((input) => input.checked) };
  if (first.type === "file") return { files: Array.from(first.files ?? []) };
  return { value: first.value };
}

function restore(entry: Entry, saved: { value: string } | { checked: boolean[] } | { files: File[] }) {
  const inputs = entry.controls as HTMLInputElement[];
  if ("files" in saved) {
    setFiles(inputs[0]!, saved.files);
    return;
  }
  if ("checked" in saved) {
    // Unchecking first: a radio's click unchecks its group, and a checked one must end up checked.
    inputs.forEach((input, index) => { if (!saved.checked[index]) setChecked(input, false); });
    inputs.forEach((input, index) => { if (saved.checked[index]) setChecked(input, true); });
    return;
  }
  const control = inputs[0]! as Control;
  if (control.tagName === "SELECT") {
    control.value = saved.value;
    fireEvents(control);
  } else setText(control as HTMLInputElement, saved.value);
}

/** Picks the dropdown's earlier option again, or empties it if it had none. Some dropdowns can't be emptied. */
async function restoreChoice(entry: Entry, label: string): Promise<boolean> {
  const control = entry.controls[0]!;
  if (!label) {
    clearList(control);
    await pause(SETTLE_MS);
    return readCurrent(entry) === "";
  }
  const option = (await openList(control, "")).find((element) => sameChoice(collapse(textOf(element)), label));
  if (!option) {
    closeList(control);
    return false;
  }
  pickOption(option);
  await pause(SETTLE_MS);
  return sameChoice(readCurrent(entry), label);
}

/** Takes a field back to what it held, whether for undo or after a fill that didn't take. A styled radio can't be
 * turned off by a click, so whether it went back is checked. */
async function putBack(entry: Entry, before: Snapshot): Promise<boolean> {
  if ("choice" in before) return restoreChoice(entry, before.choice);
  restore(entry, before);
  if (!isAriaChoice(entry.controls[0]!)) return true;
  await pause(SETTLE_MS);
  return sameSnapshot(snapshot(entry), before);
}

/** Files compare by what they are, since a File has no fields JSON can see. */
const comparable = (snap: Snapshot) => ("files" in snap ? { files: snap.files.map(({ name, size, lastModified }) => [name, size, lastModified]) } : snap);
const sameSnapshot = (left: Snapshot, right: Snapshot) => JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));

function listed(entry: Entry, found: HTMLElement[]): ChoiceList {
  entry.options = new Map(found.map((element, index) => [`c${index}`, element]));
  if (found.length === 0) return { status: "empty" };
  const options = found.map((element, index) => ({ id: `c${index}`, label: collapse(textOf(element)) }));
  return isMultiple(entry.controls[0]!) ? { status: "open", options, multiple: true } : { status: "open", options };
}

/** Writes one field at a time for the panel. Prior values stay here in the page, so undo ends with the page and
 * nothing the BDE typed leaves it. */
export function createFiller(registry: () => Registry | null) {
  let filled: Filled[] = [];

  function liveEntry(scanId: number, fieldId: string): Entry | null {
    const scan = registry();
    const entry = scan?.scanId === scanId ? scan.entries.get(fieldId) : undefined;
    return entry && entry.controls.every((control) => control.isConnected) ? entry : null;
  }

  return {
    async fill({ scanId, fieldId, write, current }: FillRequest): Promise<FillResult> {
      const entry = liveEntry(scanId, fieldId);
      if (!entry) return STALE;
      const present = readCurrent(entry);
      if (present !== current) return { status: "changed", current: present };
      const before = snapshot(entry);
      apply(entry, write);
      await pause(SETTLE_MS);
      if (!accepted(entry, write)) {
        await putBack(entry, before);
        return { status: "failed", current: readCurrent(entry) };
      }
      filled.push({ scanId, entry, write, before, after: snapshot(entry) });
      return { status: "filled", current: readCurrent(entry) };
    },

    /** Opens a custom dropdown and lists what it offers, for the panel to match the answer against. */
    async openChoices({ scanId, fieldId, current, search }: ChoiceRequest): Promise<ChoiceList> {
      const entry = liveEntry(scanId, fieldId);
      if (!entry) return { status: "stale" };
      if (readCurrent(entry) !== current) return { status: "changed" };
      return listed(entry, await openList(entry.controls[0]!, search));
    },

    async searchChoices({ scanId, fieldId, search }: ChoiceRequest): Promise<ChoiceList> {
      const entry = liveEntry(scanId, fieldId);
      return entry ? listed(entry, await searchList(entry.controls[0]!, search)) : { status: "stale" };
    },

    async pickChoice({ scanId, fieldId, optionId }: PickRequest): Promise<FillResult> {
      const entry = liveEntry(scanId, fieldId);
      const option = entry?.options.get(optionId);
      if (!entry || !option?.isConnected) return STALE;
      const before = snapshot(entry);
      const write: FieldWrite = { type: "choice", value: collapse(textOf(option)) };
      pickOption(option);
      await pause(SETTLE_MS);
      if (!accepted(entry, write)) {
        closeList(entry.controls[0]!);
        if (!sameSnapshot(snapshot(entry), before)) await putBack(entry, before);
        return { status: "failed", current: readCurrent(entry) };
      }
      filled.push({ scanId, entry, write, before, after: snapshot(entry) });
      return { status: "filled", current: readCurrent(entry) };
    },

    closeChoices({ scanId, fieldId }: ChoiceRequest) {
      const entry = liveEntry(scanId, fieldId);
      if (entry) closeList(entry.controls[0]!);
      return true;
    },

    /** A check once the whole run has settled: some pages reset a field when a later one changes. Only this run's
     * fills count: field ids restart with every scan, and an older fill may be one the BDE has since edited. */
    rejected(scanId: number, fieldIds: string[]): string[] {
      const wanted = new Set(fieldIds);
      const late = filled.filter((item) => item.scanId === scanId && wanted.has(item.entry.field.id)
        && !accepted(item.entry, item.write));
      filled = filled.filter((item) => !late.includes(item));
      return late.map(({ entry }) => entry.field.id);
    },

    /** Fields the form flagged once the run settled. Their values go back, so nothing it refused stays on the form. */
    async flagged(scanId: number, fieldIds: string[]): Promise<string[]> {
      const wanted = new Set(fieldIds);
      const found = filled.filter((item) => item.scanId === scanId && wanted.has(item.entry.field.id) && isFlagged(item.entry));
      filled = filled.filter((item) => !found.includes(item));
      for (const { entry, before } of found) await putBack(entry, before);
      return found.map(({ entry }) => entry.field.id);
    },

    /** Brings a field into view for a row the BDE clicked. The ring is an animation, so nothing stays on the form. */
    focusField({ scanId, fieldId }: FieldTarget): boolean {
      const entry = liveEntry(scanId, fieldId);
      if (!entry) return false;
      const control = entry.controls[0]!;
      const target = visiblePart(control);
      target.scrollIntoView({ block: "center" });
      target.animate(RING, RING_MS);
      control.focus({ preventScroll: true });
      return true;
    },

    /** Takes a file BenchQ attached off the page through the page's own remove control, found beside the chip that
     * names it (07 Q51): a page such as Greenhouse shows a taken file as a chip and ignores a new one put under it. Only
     * a file this frame attached is removed, and only its own chip, beside the upload it went to: a file of the same
     * name the BDE attached elsewhere, here or in another frame, stays. True once its control was clicked. */
    async removeFile(name: string): Promise<boolean> {
      const uploads = filled.filter(({ write }) => write.type === "file" && write.name === name)
        .map(({ entry }) => entry.controls[0] as HTMLInputElement);
      if (uploads.length === 0) return false;
      for (let box = ownChip(uploads, chipsNamed(name)), depth = 0; box && depth < 4; depth += 1, box = box.parentElement) {
        if (showsOtherFile(box, name)) break;
        const control = Array.from(box.querySelectorAll<HTMLElement>("button, a, [role='button']"))
          .find((element) => isVisible(element) && !element.matches(":disabled") && REMOVE_CONTROL.test(controlWords(element)));
        if (control) {
          control.click();
          await pause(SETTLE_MS);
          return true;
        }
      }
      return false;
    },

    /** Takes back BenchQ's fills of one field, as Undo would, while it still holds what BenchQ last put there: another
     * résumé picked later doesn't answer it, and its value mustn't stay behind. False when the BDE has changed it since,
     * or BenchQ never filled it. */
    async takeBack({ scanId, fieldId }: FieldTarget): Promise<boolean> {
      const entry = liveEntry(scanId, fieldId);
      if (!entry) return false;
      const mine = filled.filter((item) => item.entry.controls[0] === entry.controls[0]);
      const [first] = mine;
      if (!first || !sameSnapshot(snapshot(entry), mine.at(-1)!.after)) return false;
      filled = filled.filter((item) => !mine.includes(item));
      return putBack(entry, first.before);
    },

    async undo(): Promise<UndoResult> {
      const result: UndoResult = { restored: 0, kept: 0, skipped: 0 };
      for (const { entry, before, after } of [...filled].reverse()) {
        const untouched = entry.controls.every((control) => control.isConnected) && sameSnapshot(snapshot(entry), after);
        if (!untouched) result.kept += 1;
        else if (await putBack(entry, before)) result.restored += 1;
        else result.skipped += 1;
      }
      filled = [];
      return result;
    },

    undoCount: () => filled.length,
  };
}
