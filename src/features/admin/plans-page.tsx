"use client";

import { useCan } from "@/lib/auth/permissions";
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Eye, EyeOff, Layers, Pencil, Plus } from "lucide-react";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tag } from "@/components/ui/tag";
import { firmsOnPlan } from "@/lib/derive/platform";
import { useCreatePlan, usePlans, usePlatformFirms, useSetPlanActive, useUpdatePlan } from "@/lib/hooks/use-platform";
import { queryGroup } from "@/lib/query/query-group";
import type { Plan } from "@/lib/schemas/tenancy";
import { AdminDialog, Field, errorMessage, fieldAria } from "./admin-dialog";

/**
 * /admin/plans (docs/04 §14.6): the plan catalogue. A plan is a template (A3): editing it never
 * changes existing firms. No prices, no billing. Writes CREATE / UPDATE on `plan`, firmId null.
 */
export function PlansPage() {
  const plans = usePlans();
  const firms = usePlatformFirms();
  const group = queryGroup(plans, firms);
  const setActive = useSetPlanActive();
  const [editing, setEditing] = useState<Plan | "new" | null>(null);
  const canEdit = useCan("plan.edit");

  const columns = useMemo<ColumnDef<Plan, unknown>[]>(
    () => [
      { id: "name", header: "Plan", enableSorting: false, cell: ({ row }) => <span className="font-[600] text-[var(--color-text)]">{row.original.name}</span> },
      { id: "seats", header: "Seat limit", enableSorting: false, cell: ({ row }) => <span className="tabular">{row.original.seatLimit}</span> },
      { id: "candidates", header: "Candidate limit", enableSorting: false, cell: ({ row }) => <span className="tabular">{row.original.candidateLimit}</span> },
      {
        id: "features",
        header: "Features",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-wrap gap-1">
            {row.original.features.length ? row.original.features.map((feature) => <Tag key={feature}>{feature}</Tag>) : <span className="text-[var(--color-text-3)]">—</span>}
          </span>
        ),
      },
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
        cell: ({ row }) => !canEdit ? null : (
          <span className="inline-flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(row.original)}><Pencil size={13} aria-hidden /> Edit</Button>
            <Button variant="ghost" size="sm" disabled={setActive.isPending} onClick={() => setActive.mutate({ planId: row.original.id, isActive: !row.original.isActive })}>
              {row.original.isActive ? <><EyeOff size={13} aria-hidden /> Hide</> : <><Eye size={13} aria-hidden /> Show</>}
            </Button>
          </span>
        ),
      },
    ],
    [firms.data, setActive, canEdit],
  );

  return (
    <div className="bq-page">
      <PageHeader
        title="Plans"
        subtitle="Templates for a firm's limits. Assigning a plan copies its limits onto the firm."
        actions={canEdit ? <Button onClick={() => setEditing("new")}><Plus size={14} aria-hidden /> New plan</Button> : undefined}
      />
      {setActive.isError ? <p role="alert" className="mb-3 text-sm text-[var(--color-danger-fg)]">{errorMessage(setActive.error)}</p> : null}
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
        emptyState={<EmptyState icon={Layers} title="No plans yet" description="Create a plan to offer it to new firms." action={canEdit ? <Button onClick={() => setEditing("new")}><Plus size={14} aria-hidden /> New plan</Button> : undefined} />}
      />
      {editing ? <PlanDialog plan={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

const parseLimit = (value: string) => (/^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN);

function PlanDialog({ plan, onClose }: { plan: Plan | null; onClose: () => void }) {
  const create = useCreatePlan();
  const update = useUpdatePlan(plan?.id ?? "");
  const mutation = plan ? update : create;
  const [name, setName] = useState(plan?.name ?? "");
  const [seats, setSeats] = useState(plan ? String(plan.seatLimit) : "");
  const [candidates, setCandidates] = useState(plan ? String(plan.candidateLimit) : "");
  const [features, setFeatures] = useState(plan?.features.join("\n") ?? "");
  const input = { name: name.trim(), seatLimit: parseLimit(seats), candidateLimit: parseLimit(candidates), features: features.split("\n").map((line) => line.trim()).filter(Boolean) };
  const nameError = input.name ? null : "Enter a name.";
  const seatError = input.seatLimit >= 1 ? null : "A whole number, at least 1.";
  const candidateError = input.candidateLimit >= 1 ? null : "A whole number, at least 1.";
  const [isSubmitted, setIsSubmitted] = useState(false);
  const isValid = !nameError && !seatError && !candidateError;
  const shown = (error: string | null) => (isSubmitted ? error : null);

  return (
    <AdminDialog
      open
      onClose={onClose}
      title={plan ? `Edit ${plan.name}` : "New plan"}
      description={plan ? <p><strong>Changes apply to firms assigned this plan from now on. Existing firms keep their current limits.</strong></p> : <p>New plans are offered to new firms straight away.</p>}
      confirmLabel={plan ? "Save plan" : "Create plan"}
      pendingLabel={plan ? "Saving…" : "Creating…"}
      isPending={mutation.isPending}
      error={errorMessage(mutation.error)}
      onConfirm={() => {
        setIsSubmitted(true);
        if (isValid) mutation.mutate(input, { onSuccess: onClose });
      }}
    >
      <Field id="plan-name" label="Name" error={shown(nameError)}>
        <Input {...fieldAria("plan-name", shown(nameError))} value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="plan-seats" label="Seat limit" error={shown(seatError)}>
          <Input {...fieldAria("plan-seats", shown(seatError))} inputMode="numeric" value={seats} onChange={(event) => setSeats(event.target.value)} />
        </Field>
        <Field id="plan-candidates" label="Active candidate limit" error={shown(candidateError)}>
          <Input {...fieldAria("plan-candidates", shown(candidateError))} inputMode="numeric" value={candidates} onChange={(event) => setCandidates(event.target.value)} />
        </Field>
      </div>
      <Field id="plan-features" label="Features" hint="One per line. Labels only: nothing is switched on or off by them.">
        <textarea {...fieldAria("plan-features", null, true)} rows={4} value={features} onChange={(event) => setFeatures(event.target.value)} className="bq-input h-auto w-full py-2" />
      </Field>
    </AdminDialog>
  );
}
