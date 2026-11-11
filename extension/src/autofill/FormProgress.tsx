import { MUTED_TEXT } from "../ui";
import { filledValue } from "./form-memory";
import type { ReviewRow } from "./types";

/** How far the form is, at a glance: the fields that hold a value out of all the form's fields, and the required ones
 * still empty. Every number is counted from the rows, so it follows the BDE's typing as the panel reads the form. */
export default function FormProgress({ rows }: { rows: ReviewRow[] }) {
  const filled = rows.filter((row) => Boolean(filledValue(row))).length;
  const requiredLeft = rows.filter((row) => row.field.required && !filledValue(row)).length;
  const percent = rows.length ? Math.round((filled / rows.length) * 100) : 0;
  return <div data-slot="form-progress" className="grid gap-1.5">
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-sm font-[550] text-[var(--color-text)]">{filled} of {rows.length} fields filled</span>
      <span className={MUTED_TEXT}>{requiredLeft ? `${requiredLeft} required left` : "Required fields done"}</span>
    </div>
    <div role="progressbar" aria-label="Fields filled" aria-valuemin={0} aria-valuemax={rows.length} aria-valuenow={filled}
      className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-3)]">
      <div className="h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-[var(--duration-fast)] motion-reduce:transition-none" style={{ width: `${percent}%` }} />
    </div>
  </div>;
}
