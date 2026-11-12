"use client";

import { useCan } from "@/lib/auth/permissions";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Eye, EyeOff, Layers, Pencil } from "lucide-react";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tag } from "@/components/ui/tag";
import { CANDIDATES_PER_SEAT, JOBS_PER_CANDIDATE_PER_DAY, candidateLimitFor, formatUsd, parseUsdToCents } from "@/lib/derive/billing";
import { firmsOnPlan } from "@/lib/derive/platform";
import { usePlans, usePlatformFirms, useUpdatePlan } from "@/lib/hooks/use-platform";
import { queryGroup } from "@/lib/query/query-group";
import type { Plan } from "@/lib/schemas/tenancy";
import { AdminDialog, Field, errorMessage, fieldAria } from "./admin-dialog";

/**
 * /admin/plans (docs/04 §14.6, 07 Q64): the base plan. A firm's BDE count is the only thing that varies; a BDE brings
 * 10 candidates, and each candidate fetches 100 new jobs a day (fixed). Editing the plan changes firms created later,
 * never existing ones (A3). Super Admin only: the price appears nowhere a firm can open.
 */
export function PlansPage() {
  const plans = usePlans();
  const firms = usePlatformFirms();
  const group = queryGroup(plans, firms);
  const [editing, setEditing] = useState<Plan | null>(null);
  const canEdit = useCan("plan.edit");

  const columns = useMemo<ColumnDef<Plan, unknown>[]>(
    () => [
      { id: "name", header: "Plan", enableSorting: false, cell: ({ row }) => <span className="font-[600] text-[var(--color-text)]">{row.original.name}</span> },
      { id: "seats", header: "BDEs", enableSorting: false, cell: ({ row }) => <span className="tabular">{row.original.seatLimit}</span> },
      { id: "candidates", header: "Candidates", enableSorting: false, cell: ({ row }) => <span className="tabular">{row.original.candidateLimit}</span> },
      { id: "price", header: "Price per BDE", enableSorting: false, cell: ({ row }) => <span className="tabular">{formatUsd(row.original.priceCentsPerSeat)}</span> },
      {
        id: "status",
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => (row.original.isActive ? <Tag tone="green"><Eye size={12} aria-hidden /> Active</Tag> : <Tag tone="neutral"><EyeOff size={12} aria-hidden /> Hidden</Tag>),
      },
      { id: "firms", header: "Firms on plan", enableSorting: false, cell: ({ row }) => <span className="tabular">{firmsOnPlan(row.original.id, firms.data ?? [])}</span> },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => !canEdit ? null : <Button variant="ghost" size="sm" onClick={() => setEditing(row.original)}><Pencil size={13} aria-hidden /> Edit</Button>,
      },
    ],
    [firms.data, canEdit],
  );

  return (
    <div className="bq-page">
      <PageHeader
        title="Plans"
        subtitle={`The base plan: a new firm starts with this BDE count and ${CANDIDATES_PER_SEAT} candidates per BDE; ${JOBS_PER_CANDIDATE_PER_DAY} new jobs per candidate per day, 30-day periods.`}
      />
      <DataTable
        columns={columns}
        data={plans.data ?? []}
        getRowId={(plan) => plan.id}
        isLoading={group.status === "pending"}
        error={group.status === "error" ? group.error : null}
        onRetry={group.retry}
        isRowSelectable={false}
        hasToolbar={false}
        label="Plans"
        emptyState={<EmptyState icon={Layers} title="No plan" description="There is no base plan to offer new firms." />}
      />
      {editing ? <PlanDialog plan={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function PlanDialog({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const update = useUpdatePlan(plan.id);
  const [name, setName] = useState(plan.name);
  const [seats, setSeats] = useState(String(plan.seatLimit));
  const [price, setPrice] = useState((plan.priceCentsPerSeat / 100).toFixed(2));
  const seatLimit = /^\d+$/.test(seats.trim()) ? Number(seats.trim()) : Number.NaN;
  const priceCents = parseUsdToCents(price);
  const nameError = name.trim() ? null : "Enter a name.";
  const seatError = Number.isInteger(seatLimit) && seatLimit >= 1 && seatLimit <= 1000 ? null : "A whole number from 1 to 1000.";
  const priceError = priceCents === null ? "A price in dollars, for example 35 or 35.50." : null;
  const [isSubmitted, setIsSubmitted] = useState(false);
  const isValid = !nameError && !seatError && !priceError;
  const shown = (error: string | null) => (isSubmitted ? error : null);

  return (
    <AdminDialog
      open
      onClose={onClose}
      title={`Edit ${plan.name}`}
      description={<p><strong>Changes apply to firms created from now on. Existing firms keep their BDE count and price.</strong></p>}
      confirmLabel="Save plan"
      pendingLabel="Saving…"
      isPending={update.isPending}
      error={errorMessage(update.error)}
      onConfirm={() => {
        setIsSubmitted(true);
        if (isValid && priceCents !== null) update.mutate({ name: name.trim(), seatLimit, priceCentsPerSeat: priceCents }, { onSuccess: onClose });
      }}
    >
      <Field id="plan-name" label="Name" error={shown(nameError)}>
        <Input {...fieldAria("plan-name", shown(nameError))} value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="plan-seats" label="BDEs for a new firm" error={shown(seatError)} hint={!seatError ? `${candidateLimitFor(seatLimit)} candidates` : undefined}>
          <Input {...fieldAria("plan-seats", shown(seatError))} inputMode="numeric" value={seats} onChange={(event) => setSeats(event.target.value)} />
        </Field>
        <Field id="plan-price" label="Price per BDE (USD)" error={shown(priceError)}>
          <Input {...fieldAria("plan-price", shown(priceError))} inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
        </Field>
      </div>
    </AdminDialog>
  );
}
