import { BELOW_TOP_BAR, button, MUTED_TEXT, WARNING } from "../ui";
import { documentOf } from "./documents";
import { filledValue } from "./form-memory";
import { CHECK } from "./icons";
import { needsYou } from "./ReviewList";
import type { ReviewRow } from "./types";

const DONE = `flex items-center gap-1 ${BELOW_TOP_BAR} text-caption font-[550] text-[var(--color-success-fg)] [&_svg]:size-[var(--icon-sm)] [&_svg]:flex-none`;

type AutofillDoneProps = {
  /** What the run filled. */
  filled: number;
  rows: ReviewRow[];
  /** The last file BenchQ attached on this page, and whether a chip naming it still shows where the site swapped the
   * upload out (07 Q53). */
  attached: string | null;
  attachedShown?: boolean;
  /** Whether the panel can keep typed answers, as the review list's Save for next time does. */
  canSave: boolean;
  onGoTo: (row: ReviewRow) => void;
};

/** How a run went, once it ended (Q11), in place of a bare "Autofill complete": what BenchQ filled, what's still the
 * BDE's (the list's Needs you), what it left as the form had it, and whether the résumé went on the form, with the way
 * to its field when it didn't. Counted from the rows, so it follows the form. */
export default function AutofillDone({ filled, rows, attached, attachedShown = false, canSave, onGoTo }: AutofillDoneProps) {
  const rest = rows.filter(({ field }) => !documentOf(field));
  const needs = needsYou(rest, canSave).length;
  const kept = rest.filter((row) => row.status === "kept").length;
  // What the form's résumé upload holds now, as the page reads it: a file a site took and then cleared isn't attached.
  // The name BenchQ attached stands in only while the site's chip still names it; with neither, the résumé is missing.
  const upload = rows.find(({ field }) => field.kind === "file" && documentOf(field) === "resume");
  const onForm = upload ? filledValue(upload) : attachedShown ? attached : null;
  const isResumeMissing = upload ? !onForm : Boolean(attached) && !attachedShown;
  const summary = [`Filled ${filled}`, needs ? `${needs} need${needs === 1 ? "s" : ""} you` : "",
    kept ? `${kept} kept as ${kept === 1 ? "it was" : "they were"}` : ""].filter(Boolean).join(" · ");
  return <div className="grid gap-1.5">
    <p data-slot="autofill-done" className={DONE} role="status">{CHECK}{summary}</p>
    {onForm && <p data-slot="autofill-done-file" className={`wrap-anywhere ${MUTED_TEXT}`}>Resume attached: {onForm}</p>}
    {isResumeMissing && <div data-slot="autofill-done-no-file" className={WARNING} role="alert">
      <p className="mb-1.5">The resume isn&apos;t on the form yet. Attach it by hand.</p>
      {upload && <button type="button" className={button("secondary", "compact")} onClick={() => onGoTo(upload)}>Go to field</button>}
    </div>}
  </div>;
}
