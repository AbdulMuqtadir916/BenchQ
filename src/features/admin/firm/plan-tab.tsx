"use client";

import { Can } from "@/lib/auth/can";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { History, Users } from "lucide-react";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  CANDIDATES_PER_SEAT, JOBS_PER_CANDIDATE_PER_DAY, candidateLimitFor, formatUsd, parseUsdToCents, periodAmountCents,
} from "@/lib/derive/billing";
import { planHistory } from "@/lib/derive/platform";
import type { FirmUsage } from "@/lib/derive/tenancy";
import { useSetSeats } from "@/lib/hooks/use-platform";
import type { LedgerEntry } from "@/lib/schemas/analytics";
import { AdminDialog, Field, errorMessage, fieldAria } from "../admin-dialog";
import { AdminTime } from "../admin-time";
import { BillingPeriods } from "./billing-periods";
import { useFirmDetail, type FirmDetail } from "./use-firm-detail";

/**
 * /admin/firms/[firmId]/plan (docs/04 §14.5, 07 Q64–Q65): the firm's BDE count and candidate limit (set separately; a new firm starts at ten
 * candidates per BDE, 100 jobs per candidate per day), its price per BDE, its 30-day billing periods and the history
 * of count changes. Changing the count is allowed over current usage, with a warning first (A4: never auto-remove).
 */
export function FirmPlanTab() {
  const { detail } = useFirmDetail();
  if (!detail) return <div className="grid gap-4 lg:grid-cols-2"><SkeletonCard /><SkeletonCard /></div>;
  return <FirmPlan detail={detail} />;
}

/** The warning a lower count gets: what will be over, and that nothing is removed. */
function overWarnings(usage: FirmUsage, seatLimit: number, candidateLimit: number): string[] {
  const warnings: string[] = [];
  if (usage.seatsUsed > seatLimit) warnings.push(`This firm will be over its BDE limit (${usage.seatsUsed} / ${seatLimit}).`);
  if (usage.assignedCandidates > candidateLimit) warnings.push(`This firm will be over its candidate limit (${usage.assignedCandidates} / ${candidateLimit}).`);
  return warnings;
}

function OverWarning({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div role="alert" className="rounded-[var(--radius-md)] border border-[var(--color-warning-fg)] bg-[var(--color-warning-bg)] p-3 text-sm text-[var(--color-warning-fg)]">
      {warnings.map((warning) => <p key={warning}>{warning}</p>)}
      <p className="mt-1">Existing users keep working; new BDE invites and assignments will be blocked until it is under.</p>
    </div>
  );
}

function FirmPlan({ detail }: { detail: FirmDetail }) {
  const { firm, plan, usage, data } = detail;
  const [isChanging, setIsChanging] = useState(false);
  const history = planHistory(firm.id, data.ledger);

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-h3 text-[var(--color-text)]">{plan?.name ?? "Base plan"}</h2>
            <p className="mt-1 text-sm text-[var(--color-text-2)]">
              <span className="tabular">{firm.seatLimit}</span> BDEs · <span className="tabular">{firm.candidateLimit}</span> candidates · <span className="tabular">{JOBS_PER_CANDIDATE_PER_DAY}</span> new jobs per candidate per day
            </p>
            <p className="mt-1 text-sm text-[var(--color-text-2)]">
              <span className="tabular">{formatUsd(firm.priceCentsPerSeat)}</span> per BDE · <span className="tabular text-[var(--color-text)]">{formatUsd(periodAmountCents(firm.seatLimit, firm.priceCentsPerSeat))}</span> for 30 days
            </p>
            <p className="mt-1 text-caption text-[var(--color-text-3)]">
              In use: {usage.seatsUsed} BDEs, {usage.assignedCandidates} assigned candidates.
            </p>
          </div>
          <Can action="firm.edit">
            <Button variant="secondary" size="sm" onClick={() => setIsChanging(true)}><Users size={14} aria-hidden /> Change limits</Button>
          </Can>
        </div>
      </Card>

      <BillingPeriods detail={detail} />

      <section aria-labelledby="plan-history-heading">
        <h2 id="plan-history-heading" className="mb-3 text-h3 text-[var(--color-text)]">History</h2>
        <HistoryTable entries={history} />
      </section>

      {isChanging ? <SeatsDialog detail={detail} onClose={() => setIsChanging(false)} /> : null}
    </div>
  );
}

function HistoryTable({ entries }: { entries: LedgerEntry[] }) {
  const columns = useMemo<ColumnDef<LedgerEntry, unknown>[]>(
    () => [
      { id: "when", header: "When", enableSorting: false, cell: ({ row }) => <AdminTime iso={row.original.createdAt} /> },
      { id: "by", header: "By", enableSorting: false, cell: ({ row }) => row.original.actorName },
      { id: "kind", header: "Change", enableSorting: false, cell: ({ row }) => (row.original.entityType === "firm_limits" ? "Limits" : "Plan") },
      { id: "summary", header: "Before → after", enableSorting: false, cell: ({ row }) => <span className="text-[var(--color-text)]">{row.original.summary}</span> },
    ],
    [],
  );
  return (
    <DataTable
      columns={columns}
      data={entries}
      getRowId={(entry) => entry.id}
      isRowSelectable={false}
      hasToolbar={false}
      label="Plan history"
      emptyState={<EmptyState icon={History} variant="filtered" title="No changes" description="The firm still has the limits it was created with." />}
    />
  );
}

function SeatsDialog({ detail, onClose }: { detail: FirmDetail; onClose: () => void }) {
  const { firm, usage } = detail;
  const setSeats = useSetSeats(firm.id);
  const [seats, setSeatsText] = useState(String(firm.seatLimit));
  const [candidates, setCandidatesText] = useState(String(firm.candidateLimit));
  const [price, setPrice] = useState((firm.priceCentsPerSeat / 100).toFixed(2));
  const seatLimit = /^\d+$/.test(seats.trim()) ? Number(seats.trim()) : Number.NaN;
  const candidateLimit = /^\d+$/.test(candidates.trim()) ? Number(candidates.trim()) : Number.NaN;
  const candidateError = Number.isInteger(candidateLimit) && candidateLimit <= 100000 ? null : "A whole number from 0 to 100000.";
  const priceCents = parseUsdToCents(price);
  const seatError = Number.isInteger(seatLimit) && seatLimit >= 1 && seatLimit <= 1000 ? null : "A whole number from 1 to 1000.";
  const priceError = priceCents === null ? "A price in dollars, for example 35 or 35.50." : null;
  const isValid = !seatError && !candidateError && !priceError;
  const isSame = seatLimit === firm.seatLimit && candidateLimit === firm.candidateLimit && priceCents === firm.priceCentsPerSeat;
  return (
    <AdminDialog
      open
      onClose={onClose}
      title="Change limits"
      description={<p>The candidate limit is its own number: changing the BDE count never moves it. A period running now takes the new numbers, with no proration.</p>}
      confirmLabel="Save"
      pendingLabel="Saving…"
      isPending={setSeats.isPending}
      canConfirm={isValid && !isSame}
      error={errorMessage(setSeats.error)}
      onConfirm={() => priceCents !== null && setSeats.mutate({ seatLimit, candidateLimit, priceCentsPerSeat: priceCents }, { onSuccess: onClose })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="firm-seats"
          label="BDEs"
          error={seatError}
          hint={isValid ? `${formatUsd(periodAmountCents(seatLimit, priceCents ?? 0))} for 30 days` : undefined}
        >
          <Input {...fieldAria("firm-seats", seatError)} inputMode="numeric" value={seats} onChange={(event) => setSeatsText(event.target.value)} />
        </Field>
        <Field
          id="firm-candidates"
          label="Candidate limit"
          error={candidateError}
          hint={Number.isInteger(seatLimit) ? `${CANDIDATES_PER_SEAT} per BDE would be ${candidateLimitFor(seatLimit)}.` : undefined}
        >
          <Input {...fieldAria("firm-candidates", candidateError)} inputMode="numeric" value={candidates} onChange={(event) => setCandidatesText(event.target.value)} />
        </Field>
        <Field id="firm-price" label="Price per BDE (USD)" error={priceError}>
          <Input {...fieldAria("firm-price", priceError)} inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
        </Field>
      </div>
      {isValid ? <OverWarning warnings={overWarnings(usage, seatLimit, candidateLimit)} /> : null}
    </AdminDialog>
  );
}
