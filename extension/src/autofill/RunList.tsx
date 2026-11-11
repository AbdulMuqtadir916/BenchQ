import { useEffect, useRef } from "react";
import { SOFT_TEXT } from "../ui";
import { ALERT_ICON, SPINNER_ICON } from "./icons";
import { Tick } from "./marks";
import type { AutofillRun, RunItem } from "./types";

const MARK = "mt-0.5 grid size-[var(--icon-md)] flex-none place-items-center [&_svg]:size-full";
const ROW = "-mx-1.5 flex animate-rise-in gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 data-[status=filling]:bg-[var(--color-surface-2)]";
const NOTE = "text-caption text-[var(--color-text-3)] wrap-anywhere";

function Mark({ status }: Pick<RunItem, "status">) {
  if (status === "filled") return <Tick isFilled slot="run-mark" isNew />;
  if (status === "filling") {
    return <span data-slot="run-mark" className={`${MARK} text-[var(--color-primary)] [&_svg]:animate-spin`} role="img" aria-label="Filling">{SPINNER_ICON}</span>;
  }
  return <span data-slot="run-mark" className={`${MARK} text-[var(--color-warning-fg)]`} role="img" aria-label="Not filled">{ALERT_ICON}</span>;
}

/** The fields an Autofill run sets out to fill. Each joins the list as BenchQ reaches it, with a spinner while it fills,
 * then a green tick and the value it took, or a warning and why it's the BDE's. The run never waits for the list. */
export default function RunList({ run: { total, items } }: { run: AutofillRun }) {
  const latest = useRef<HTMLLIElement>(null);
  const done = items.filter(({ status }) => status !== "filling").length;

  // The newest row stays in view, without smooth scrolling, which a fast run would only blur.
  useEffect(() => {
    latest.current?.scrollIntoView({ block: "nearest" });
  }, [items.length]);

  return <section data-slot="run" className="grid min-w-0 gap-1" aria-labelledby="run-title">
    <div className="flex items-baseline justify-between gap-2">
      <h3 id="run-title" className="text-sm font-[550]">Filling the form</h3>
      <span data-slot="run-count" className="text-mono-sm text-[var(--color-text-3)]" role="status">{done} of {total}</span>
    </div>
    <ol className="grid gap-0.5">
      {items.map((item, index) => <li key={item.key} ref={index === items.length - 1 ? latest : undefined} data-slot="run-row" data-status={item.status} className={ROW}>
        <Mark status={item.status} />
        <span className="grid min-w-0 flex-1">
          <span className="min-w-0 text-body-strong text-[var(--color-text)] wrap-anywhere">{item.label}</span>
          {item.status === "filled" && item.value && <span className={`truncate ${SOFT_TEXT}`} title={item.value}>{item.value}</span>}
          {item.status === "failed" && item.reason && <span className={NOTE}>{item.reason}</span>}
        </span>
      </li>)}
    </ol>
  </section>;
}
