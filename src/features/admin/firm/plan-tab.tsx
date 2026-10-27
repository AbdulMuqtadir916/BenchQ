"use client";

import { Can } from "@/lib/auth/can";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { History, Layers, SlidersHorizontal } from "lucide-react";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { SkeletonCard } from "@/components/app/skeleton-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { planHistory } from "@/lib/derive/platform";
import type { FirmUsage } from "@/lib/derive/tenancy";
import { useAdjustLimits, useChangePlan } from "@/lib/hooks/use-platform";
import type { LedgerEntry } from "@/lib/schemas/analytics";
import { AdminDialog, Field, errorMessage, fieldAria } from "../admin-dialog";
import { AdminTime } from "../admin-time";
import { CustomLimitsBadge } from "../firm-badges";
import { useFirmDetail, type FirmDetail } from "./use-firm-detail";

/**
 * /admin/firms/[firmId]/plan (docs/04 §14.5 Plan tab): the effective limits, Change plan (copies the
 * plan's limits, A3) and Adjust limits (custom limits, 07 Q29–Q30). Both are allowed over current
 * usage, with a warning first (A4: never auto-remove). History is derived from PLAN_CHANGED (A14).
 */
export function FirmPlanTab() {
  const { detail } = useFirmDetail();
  if (!detail) return <div className="grid gap-4 lg:grid-cols-2"><SkeletonCard /><SkeletonCard /></div>;
  return <FirmPlan detail={detail} />;
}

/** The warning a lower limit gets: what will be over, and that nothing is removed. */
function overWarnings(usage: FirmUsage, limits: { seatLimit: number; candidateLimit: number }): string[] {
  const warnings: string[] = [];
  if (usage.seatsUsed > limits.seatLimit) warnings.push(`This firm will be over its seat limit (${usage.seatsUsed} / ${limits.seatLimit}).`);
  if (usage.activeCandidates > limits.candidateLimit) warnings.push(`This firm will be over its candidate limit (${usage.activeCandidates} / ${limits.candidateLimit}).`);
  return warnings;
}

function OverWarning({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div role="alert" className="rounded-[var(--radius-md)] border border-[var(--color-warning-fg)] bg-[var(--color-warning-bg)] p-3 text-sm text-[var(--color-warning-fg)]">
      {warnings.map((warning) => <p key={warning}>{warning}</p>)}
      <p className="mt-1">Existing users keep working; new additions will be blocked.</p>
    </div>
  );
}

function FirmPlan({ detail }: { detail: FirmDetail }) {
  const { firm, plan, usage, isCustom, data } = detail;
  const [dialog, setDialog] = useState<"plan" | "limits" | null>(null);
  const history = planHistory(firm.id, data.ledger);

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex flex-wrap items-center gap-2 text-h3 text-[var(--color-text)]">
              {plan?.name ?? "Unknown plan"} {isCustom ? <CustomLimitsBadge /> : null}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-2)]">
              <span className="tabular">{firm.seatLimit}</span> BDE seats · <span className="tabular">{firm.candidateLimit}</span> active candidates
              {isCustom && plan ? <span className="text-[var(--color-text-3)]"> (plan: {plan.seatLimit} BDE seats, {plan.candidateLimit} candidates)</span> : null}
            </p>
            <p className="mt-1 text-caption text-[var(--color-text-3)]">
              In use: {usage.seatsUsed} BDE seats, {usage.activeCandidates} active candidates.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Can action="firm.edit">
              <Button variant="secondary" size="sm" onClick={() => setDialog("plan")}><Layers size={14} aria-hidden /> Change plan</Button>
              <Button variant="secondary" size="sm" onClick={() => setDialog("limits")}><SlidersHorizontal size={14} aria-hidden /> Adjust limits</Button>
            </Can>
          </div>
        </div>
      </Card>

      <section aria-labelledby="plan-history-heading">
        <h2 id="plan-history-heading" className="mb-3 text-h3 text-[var(--color-text)]">History</h2>
        <HistoryTable entries={history} />
      </section>

      {dialog === "plan" ? <ChangePlanDialog detail={detail} onClose={() => setDialog(null)} /> : null}
      {dialog === "limits" ? <AdjustLimitsDialog detail={detail} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

function HistoryTable({ entries }: { entries: LedgerEntry[] }) {
  const columns = useMemo<ColumnDef<LedgerEntry, unknown>[]>(
    () => [
      { id: "when", header: "When", enableSorting: false, cell: ({ row }) => <AdminTime iso={row.original.createdAt} /> },
      { id: "by", header: "By", enableSorting: false, cell: ({ row }) => row.original.actorName },
      { id: "kind", header: "Change", enableSorting: false, cell: ({ row }) => (row.original.entityType === "firm_limits" ? "Custom limits" : "Plan") },
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
      emptyState={<EmptyState icon={History} variant="filtered" title="No plan changes" description="The firm is still on the plan it was created with." />}
    />
  );
}

function ChangePlanDialog({ detail, onClose }: { detail: FirmDetail; onClose: () => void }) {
  const { firm, plans, usage } = detail;
  const change = useChangePlan(firm.id);
  const offered = plans.filter((plan) => plan.isActive || plan.id === firm.planId);
  const [planId, setPlanId] = useState(offered.find((plan) => plan.id !== firm.planId)?.id ?? firm.planId);
  const target = offered.find((plan) => plan.id === planId);
  const isSame = !target || (target.id === firm.planId && target.seatLimit === firm.seatLimit && target.candidateLimit === firm.candidateLimit);
  return (
    <AdminDialog
      open
      onClose={onClose}
      title="Change plan"
      description={<p>The firm gets the new plan&apos;s limits. Later edits to the plan don&apos;t change this firm.</p>}
      confirmLabel="Change plan"
      pendingLabel="Changing…"
      isPending={change.isPending}
      canConfirm={!isSame}
      error={errorMessage(change.error)}
      onConfirm={() => change.mutate(planId, { onSuccess: onClose })}
    >
      <Field id="change-plan" label="Plan" hint={target ? `New limits: ${target.seatLimit} BDE seats, ${target.candidateLimit} active candidates.` : undefined}>
        <select {...fieldAria("change-plan", null, true)} value={planId} onChange={(event) => setPlanId(event.target.value)} className="bq-input w-full">
          {offered.map((plan) => (
            <option key={plan.id} value={plan.id}>{plan.name}{plan.id === firm.planId ? " (current)" : ""}</option>
          ))}
        </select>
      </Field>
      {target ? <OverWarning warnings={overWarnings(usage, target)} /> : null}
    </AdminDialog>
  );
}

const parseLimit = (value: string) => (/^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN);

function AdjustLimitsDialog({ detail, onClose }: { detail: FirmDetail; onClose: () => void }) {
  const { firm, usage } = detail;
  const adjust = useAdjustLimits(firm.id);
  const [seats, setSeats] = useState(String(firm.seatLimit));
  const [candidates, setCandidates] = useState(String(firm.candidateLimit));
  const limits = { seatLimit: parseLimit(seats), candidateLimit: parseLimit(candidates) };
  const seatError = Number.isInteger(limits.seatLimit) && limits.seatLimit >= 1 ? null : "A whole number, at least 1.";
  const candidateError = Number.isInteger(limits.candidateLimit) && limits.candidateLimit >= 1 ? null : "A whole number, at least 1.";
  const isValid = !seatError && !candidateError;
  const isSame = limits.seatLimit === firm.seatLimit && limits.candidateLimit === firm.candidateLimit;
  return (
    <AdminDialog
      open
      onClose={onClose}
      title="Adjust limits"
      description={<p>Set limits different from the plan&apos;s. The firm is marked &ldquo;custom limits&rdquo; until its plan is changed again.</p>}
      confirmLabel="Save limits"
      pendingLabel="Saving…"
      isPending={adjust.isPending}
      canConfirm={isValid && !isSame}
      error={errorMessage(adjust.error)}
      onConfirm={() => adjust.mutate(limits, { onSuccess: onClose })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="limit-seats" label="BDE seat limit" error={seatError}>
          <Input {...fieldAria("limit-seats", seatError)} inputMode="numeric" value={seats} onChange={(event) => setSeats(event.target.value)} />
        </Field>
        <Field id="limit-candidates" label="Active candidate limit" error={candidateError}>
          <Input {...fieldAria("limit-candidates", candidateError)} inputMode="numeric" value={candidates} onChange={(event) => setCandidates(event.target.value)} />
        </Field>
      </div>
      {isValid ? <OverWarning warnings={overWarnings(usage, limits)} /> : null}
    </AdminDialog>
  );
}
