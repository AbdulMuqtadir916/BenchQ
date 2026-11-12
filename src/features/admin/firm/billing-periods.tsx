"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarPlus, Check, ReceiptText, Undo2 } from "lucide-react";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tag } from "@/components/ui/tag";
import { Can } from "@/lib/auth/can";
import { BILLING_PERIOD_DAYS, billingState, currentPeriod, formatDay, formatUsd, todayInIndia } from "@/lib/derive/billing";
import { useEditPeriod, useStartPeriod } from "@/lib/hooks/use-platform";
import type { BillingPeriod } from "@/lib/schemas/tenancy";
import { AdminDialog, Field, errorMessage, fieldAria } from "../admin-dialog";
import type { FirmDetail } from "./use-firm-detail";

/**
 * A firm's billing record (docs/02 §3.5, 07 Q65): its 30-day periods, each a snapshot of the BDE count, the price and
 * the calculated amount. Start next 30 days copies the firm's current limits; Mark paid / unpaid edits one period.
 * Super Admin only: amounts appear nowhere a firm can open.
 */
export function BillingPeriods({ detail }: { detail: FirmDetail }) {
  const { firm, periods, now } = detail;
  const today = todayInIndia(now);
  const state = billingState(firm.id, periods, today);
  const running = currentPeriod(periods, today);
  const [dialog, setDialog] = useState<"start" | BillingPeriod | null>(null);

  const columns = useMemo<ColumnDef<BillingPeriod, unknown>[]>(
    () => [
      { id: "period", header: "Period", enableSorting: false, cell: ({ row }) => <span className="tabular text-[var(--color-text)]">{formatDay(row.original.startsOn)} – {formatDay(row.original.endsOn)}</span> },
      { id: "bdes", header: "BDEs", enableSorting: false, cell: ({ row }) => <span className="tabular">{row.original.seatLimit}</span> },
      { id: "candidates", header: "Candidates", enableSorting: false, cell: ({ row }) => <span className="tabular">{row.original.candidateLimit}</span> },
      { id: "price", header: "Per BDE", enableSorting: false, cell: ({ row }) => <span className="tabular">{formatUsd(row.original.priceCentsPerSeat)}</span> },
      { id: "amount", header: "Amount", enableSorting: false, cell: ({ row }) => <span className="tabular font-[600] text-[var(--color-text)]">{formatUsd(row.original.amountCents)}</span> },
      {
        id: "status",
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => row.original.status === "PAID"
          ? <Tag tone="green"><Check size={12} aria-hidden /> Paid {row.original.paidOn ? formatDay(row.original.paidOn) : ""}</Tag>
          : <Tag tone="amber">Unpaid</Tag>,
      },
      { id: "note", header: "Note", enableSorting: false, cell: ({ row }) => row.original.note ?? <span className="text-[var(--color-text-3)]">—</span> },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <Can action="billing.edit">
            <Button variant="ghost" size="sm" onClick={() => setDialog(row.original)}>
              {row.original.status === "PAID" ? <><Undo2 size={13} aria-hidden /> Edit</> : <><Check size={13} aria-hidden /> Mark paid</>}
            </Button>
          </Can>
        ),
      },
    ],
    [setDialog],
  );

  return (
    <section aria-labelledby="billing-heading" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="billing-heading" className="flex flex-wrap items-center gap-2 text-h3 text-[var(--color-text)]">
            Billing
            {state === "overdue" ? <Tag tone="red">Payment overdue</Tag> : state === "none" ? <Tag tone="neutral">No billing period</Tag> : <Tag tone="green">Paid</Tag>}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-2)]">
            {running ? `Running now: ${formatDay(running.startsOn)} – ${formatDay(running.endsOn)}, ${formatUsd(running.amountCents)}.` : "No period is running today."}
            {" "}Amounts are the BDE count times the price per BDE, for {BILLING_PERIOD_DAYS} days. The firm never sees them.
          </p>
        </div>
        <Can action="billing.edit">
          <Button variant="secondary" size="sm" onClick={() => setDialog("start")}><CalendarPlus size={14} aria-hidden /> Start next {BILLING_PERIOD_DAYS} days</Button>
        </Can>
      </div>
      <DataTable
        columns={columns}
        data={periods}
        getRowId={(period) => period.id}
        isRowSelectable={false}
        hasToolbar={false}
        label="Billing periods"
        emptyState={<EmptyState icon={ReceiptText} variant="filtered" title="No billing period" description="Start the first 30 days once the firm has agreed its BDEs and price." />}
      />
      {dialog === "start" ? <StartPeriodDialog detail={detail} onClose={() => setDialog(null)} /> : null}
      {dialog && dialog !== "start" ? <EditPeriodDialog period={dialog} onClose={() => setDialog(null)} /> : null}
    </section>
  );
}

function StartPeriodDialog({ detail, onClose }: { detail: FirmDetail; onClose: () => void }) {
  const { firm, periods } = detail;
  const start = useStartPeriod(firm.id);
  const last = periods[0] ?? null;
  const [startsOn, setStartsOn] = useState("");
  const [note, setNote] = useState("");
  return (
    <AdminDialog
      open
      onClose={onClose}
      title={`Start next ${BILLING_PERIOD_DAYS} days`}
      description={<p>A new period copies the firm&apos;s BDE count ({firm.seatLimit}), candidate limit ({firm.candidateLimit}) and price per BDE as they are now.{last ? ` The last one ends ${formatDay(last.endsOn)}.` : ""}</p>}
      confirmLabel="Start period"
      pendingLabel="Starting…"
      isPending={start.isPending}
      error={errorMessage(start.error)}
      onConfirm={() => start.mutate({ startsOn: startsOn || undefined, note: note.trim() || undefined }, { onSuccess: onClose })}
    >
      <Field id="period-start" label="Starts on" hint={last ? "Leave empty to start the day after the last period ends." : "Leave empty to start today."}>
        <Input {...fieldAria("period-start", null, true)} type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
      </Field>
      <Field id="period-note" label="Note (optional)">
        <Input {...fieldAria("period-note", null, true)} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
      </Field>
    </AdminDialog>
  );
}

function EditPeriodDialog({ period, onClose }: { period: BillingPeriod; onClose: () => void }) {
  const edit = useEditPeriod(period.id);
  const [status, setStatus] = useState<"PAID" | "UNPAID">("PAID");
  const [paidOn, setPaidOn] = useState(period.paidOn ?? "");
  const [note, setNote] = useState(period.note ?? "");
  return (
    <AdminDialog
      open
      onClose={onClose}
      title={`${formatDay(period.startsOn)} – ${formatDay(period.endsOn)}`}
      description={<p>{period.seatLimit} BDEs at {formatUsd(period.priceCentsPerSeat)}: {formatUsd(period.amountCents)}.</p>}
      confirmLabel="Save"
      pendingLabel="Saving…"
      isPending={edit.isPending}
      error={errorMessage(edit.error)}
      onConfirm={() => edit.mutate({ status, paidOn: status === "PAID" ? paidOn || undefined : undefined, note }, { onSuccess: onClose })}
    >
      <Field id="period-status" label="Status">
        <select {...fieldAria("period-status", null, true)} value={status} onChange={(event) => setStatus(event.target.value as "PAID" | "UNPAID")} className="bq-input w-full">
          <option value="PAID">Paid</option>
          <option value="UNPAID">Unpaid</option>
        </select>
      </Field>
      {status === "PAID" ? (
        <Field id="period-paid-on" label="Paid on" hint="Leave empty for today.">
          <Input {...fieldAria("period-paid-on", null, true)} type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
        </Field>
      ) : null}
      <Field id="period-edit-note" label="Note">
        <Input {...fieldAria("period-edit-note", null, true)} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
      </Field>
    </AdminDialog>
  );
}
