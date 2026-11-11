import type { AppliedField, AppliedForm, ReviewRow, TabField } from "./types";

// backend/applications/tracking.py refuses more than this.
const MAX_FIELDS = 200;
const MAX_LABEL = 500;
const MAX_VALUE = 4000;

type FormMemory = Map<string, AppliedField>;

/** Each job's form as BenchQ last saw it, across every page of it. The form is often gone after submit, so this keeps
 * what was seen. It lives in this panel alone: a candidate's answers never go into Chrome storage, so closing the panel
 * loses it. */
const forms = new Map<string, FormMemory>();

export function formOf(applicationId: string): FormMemory {
  const found = forms.get(applicationId);
  if (found) return found;
  const fresh: FormMemory = new Map();
  forms.set(applicationId, fresh);
  return fresh;
}

export const forgetForm = (applicationId: string) => forms.delete(applicationId);
export const forgetForms = () => forms.clear();

export const fieldLabel = ({ label }: Pick<TabField, "label">) => label || "Unlabeled field";

/** What a row's field holds, or nothing if it still needs filling. A box that should stay unchecked is already right. */
export const filledValue = ({ field, status, proposed }: ReviewRow) =>
  field.current || (status === "same" ? proposed ?? "" : "");

/** Takes in the fields on the page now. A field on another page keeps what it last held. */
export function rememberRows(form: FormMemory, rows: ReviewRow[], autofilled: ReadonlyMap<string, string>) {
  for (const row of rows) {
    const value = filledValue(row);
    if (!value || row.isUnsaved) form.delete(row.key);
    else if (form.get(row.key)?.value !== value) {
      const { field, key } = row;
      form.set(key, {
        label: fieldLabel(field), value, required: field.required,
        source: autofilled.get(key) === field.current ? "autofill" : "bde",
      });
    }
  }
}

/** By whole characters, so an emoji is never cut in half. A NUL can't be stored. */
const cut = (text: string, limit: number) => Array.from(text.replaceAll("\0", "")).slice(0, limit).join("");

export const appliedForm = (form: FormMemory): AppliedForm => ({
  fields: Array.from(form.values()).slice(0, MAX_FIELDS).map((field) => ({
    ...field, label: cut(field.label, MAX_LABEL), value: cut(field.value, MAX_VALUE),
  })),
});
