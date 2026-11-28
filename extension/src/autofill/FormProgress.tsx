import { MUTED_TEXT } from "../ui";
import { filledValue, needsRequiredAnswer } from "./form-memory";
import type { ReviewRow } from "./types";

/** How far the form is, at a glance: the fields that hold a value out of all the form's fields, and the required ones
 * still empty. Every number is counted from the rows, so it follows the BDE's typing as the panel reads the form.
 * `isRestarting`: a switch of résumé is refilling the form, so what BenchQ wrote for the old one doesn't count yet: the
 * count starts afresh and climbs as the new answers go in. Once the refill is over, every field that holds a value
 * counts, including an old one the refill couldn't take back (a radio button, a dropdown that won't clear). */
/** `isCompact`: one small line and a hairline bar, under the filled form's heading. */
export default function FormProgress({ rows, isRestarting = false, isCompact = false }: { rows: ReviewRow[]; isRestarting?: boolean; isCompact?: boolean }) {
  const isFilled = (row: ReviewRow) => (row.field.required ? !needsRequiredAnswer(row) : Boolean(filledValue(row))) && !(isRestarting && row.isOldFill);
  const filled = rows.filter(isFilled).length;
  const requiredLeft = rows.filter((row) => row.field.required && !isFilled(row)).length;
  const percent = rows.length ? Math.round((filled / rows.length) * 100) : 0;
  return <div data-slot="form-progress" className={isCompact ? "grid gap-1" : "grid gap-1.5"}>
    <div className="flex items-baseline justify-between gap-2">
      <span className={isCompact ? "text-caption font-[550] text-[var(--color-text-2)]" : "text-sm font-[550] text-[var(--color-text)]"}>{filled} of {rows.length} fields filled</span>
      <span className={isCompact ? "text-caption text-[var(--color-text-3)]" : MUTED_TEXT}>{requiredLeft ? `${requiredLeft} required left` : "Required fields done"}</span>
    </div>
    <div role="progressbar" aria-label="Fields filled" aria-valuemin={0} aria-valuemax={rows.length} aria-valuenow={filled}
      className={`${isCompact ? "h-1" : "h-1.5"} overflow-hidden rounded-full bg-[var(--color-surface-3)]`}>
      <div className="h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-[var(--duration-fast)] motion-reduce:transition-none" style={{ width: `${percent}%` }} />
    </div>
  </div>;
}
