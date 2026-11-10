"use client";

import type { ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowRight, Users } from "lucide-react";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { Tag, type TagTone } from "@/components/ui/tag";
import { cn } from "@/lib/cn";
import type { Candidate } from "@/lib/schemas/candidate";
import type { BdeRow, CandidateRow, ManagerRow } from "./activity-numbers";

const number = (value: number) => <span className="tabular text-[var(--color-text)]">{value}</span>;
const opens = { id: "opens", header: "", enableSorting: false, cell: () => <ArrowRight size={15} aria-hidden className="text-[var(--color-text-3)]" /> };
const rate = (responses: number, applications: number) => (applications ? `${Math.round((100 * responses) / applications)}%` : "—");

function Person({ name, detail }: { name: string; detail: string }) {
  return (
    <div className="min-w-0">
      <span className="block truncate font-medium text-[var(--color-text)]">{name}</span>
      <span className="block truncate text-caption text-[var(--color-text-3)]">{detail}</span>
    </div>
  );
}

const managerColumns: ColumnDef<ManagerRow, unknown>[] = [
  { id: "name", accessorFn: (row) => row.name, header: "Manager", cell: ({ row }) => <Person name={row.original.name} detail={row.original.isActive ? "Active" : "Inactive"} /> },
  { id: "bdes", accessorFn: (row) => row.bdes, header: "BDEs", cell: ({ row }) => number(row.original.bdes) },
  {
    id: "candidates", accessorFn: (row) => row.candidates, header: "Candidates",
    cell: ({ row }) => (
      <div>
        {number(row.original.candidates)}
        {row.original.withoutBde ? <span className="block whitespace-nowrap text-caption text-[var(--color-warning-fg)]">{row.original.withoutBde} without a BDE</span> : null}
      </div>
    ),
  },
  { id: "applications", accessorFn: (row) => row.counts.applications, header: "Applications", cell: ({ row }) => number(row.original.counts.applications) },
  { id: "interviews", accessorFn: (row) => row.counts.interviews, header: "Interviews", cell: ({ row }) => number(row.original.counts.interviews) },
  { id: "placements", accessorFn: (row) => row.counts.placements, header: "Placements", cell: ({ row }) => number(row.original.counts.placements) },
  opens,
];

const bdeColumns = (capacity: number): ColumnDef<BdeRow, unknown>[] => [
  { id: "name", accessorFn: (row) => row.name, header: "BDE", cell: ({ row }) => <Person name={row.original.name} detail={row.original.isActive ? "Active" : "Inactive"} /> },
  {
    id: "load", accessorFn: (row) => row.working, header: "Workload",
    cell: ({ row }) => (
      <span className={cn("tabular", row.original.working >= capacity ? "text-[var(--color-warning-fg)]" : "text-[var(--color-text)]")}
        title={`${row.original.working} candidates being worked, of a capacity of ${capacity}`}>
        {row.original.working} / {capacity}
      </span>
    ),
  },
  { id: "candidates", accessorFn: (row) => row.candidates, header: "Candidates", cell: ({ row }) => number(row.original.candidates) },
  { id: "applications", accessorFn: (row) => row.counts.applications, header: "Applications", cell: ({ row }) => number(row.original.counts.applications) },
  { id: "responses", accessorFn: (row) => row.counts.responses, header: "Responses", cell: ({ row }) => number(row.original.counts.responses) },
  { id: "responseRate", accessorFn: (row) => (row.counts.applications ? row.counts.responses / row.counts.applications : -1), header: "Response rate", cell: ({ row }) => <span className="tabular text-[var(--color-text)]">{rate(row.original.counts.responses, row.original.counts.applications)}</span> },
  { id: "interviews", accessorFn: (row) => row.counts.interviews, header: "Interviews", cell: ({ row }) => number(row.original.counts.interviews) },
  { id: "placements", accessorFn: (row) => row.counts.placements, header: "Placements", cell: ({ row }) => number(row.original.counts.placements) },
  opens,
];

const STATUS: Record<Candidate["status"], { label: string; tone: TagTone }> = {
  ON_BENCH: { label: "On bench", tone: "blue" },
  INTERVIEWING: { label: "Interviewing", tone: "violet" },
  OFFER: { label: "Offer", tone: "green" },
  PLACED: { label: "Placed", tone: "teal" },
  PAUSED: { label: "Paused", tone: "amber" },
  INACTIVE: { label: "Inactive", tone: "neutral" },
};

const dayLabel = (iso: string | null) => (iso ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso)) : "—");

const candidateColumns: ColumnDef<CandidateRow, unknown>[] = [
  { id: "name", accessorFn: (row) => row.candidate.fullName, header: "Candidate", cell: ({ row }) => <Person name={row.original.candidate.fullName} detail={row.original.candidate.primaryRole ?? "Role not set"} /> },
  { id: "status", accessorFn: (row) => row.candidate.status, header: "Status", cell: ({ row }) => <Tag tone={STATUS[row.original.candidate.status].tone}>{STATUS[row.original.candidate.status].label}</Tag> },
  { id: "applications", accessorFn: (row) => row.counts.applications, header: "Applications", cell: ({ row }) => number(row.original.counts.applications) },
  { id: "interviews", accessorFn: (row) => row.counts.interviews, header: "Interviews", cell: ({ row }) => number(row.original.counts.interviews) },
  { id: "lastActivity", accessorFn: (row) => row.lastActivity ?? "", header: "Last activity", cell: ({ row }) => <span className="whitespace-nowrap text-[var(--color-text-2)]">{dayLabel(row.original.lastActivity)}</span> },
  opens,
];

export function ManagerTable({ rows, onOpen, emptyState }: { rows: ManagerRow[]; onOpen: (row: ManagerRow) => void; emptyState?: ReactNode }) {
  return <DataTable columns={managerColumns} data={rows} getRowId={(row) => row.id} onRowClick={onOpen} hasToolbar={false} isRowSelectable={false} label="Managers"
    emptyState={emptyState ?? <EmptyState icon={Users} title="No managers yet" description="Managers show up here once the owner invites them." />} />;
}

export function BdeTable({ rows, capacity, onOpen }: { rows: BdeRow[]; capacity: number; onOpen: (row: BdeRow) => void }) {
  return <DataTable columns={bdeColumns(capacity)} data={rows} getRowId={(row) => row.id} onRowClick={onOpen} hasToolbar={false} isRowSelectable={false} label="BDEs"
    emptyState={<EmptyState icon={Users} title="No BDEs on this team" description="BDEs show up here once they report to this manager." />} />;
}

export function CandidateTable({ rows, onOpen }: { rows: CandidateRow[]; onOpen: (row: CandidateRow) => void }) {
  return <DataTable columns={candidateColumns} data={rows} getRowId={(row) => row.candidate.id} onRowClick={onOpen} hasToolbar={false} isRowSelectable={false} label="Candidates"
    emptyState={<EmptyState icon={Users} title="No candidates yet" description="Candidates assigned to this BDE show up here." />} />;
}
