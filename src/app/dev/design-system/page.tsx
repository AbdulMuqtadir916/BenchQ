"use client";

import { useRef, useState } from "react";
import { notFound } from "next/navigation";
import { Plus, Download, Check, X, SlidersHorizontal, ArrowUpRight } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, type Density } from "@/components/app/data-table";
import { ClaimChip } from "@/components/app/claim-chip";
import { StatusRing } from "@/components/app/status-ring";
import { AvatarStack } from "@/components/app/avatar-stack";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tag } from "@/components/ui/tag";
import { formatDueDate } from "@/lib/format/timezone";
import { StageOneShowcase } from "@/components/dev/stage-one-showcase";
import { DesignFoundations, DesignPatterns } from "@/components/dev/design-foundations";
import { devRoutesEnabled } from "@/lib/routes/registry";

type TaskRing = "todo" | "in-progress" | "done";
type TaskRow = {
  id: string;
  task: string;
  description: string;
  assignees: string[];
  dueAt: string;
  ring: TaskRing;
};
const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const INITIAL_ROWS: TaskRow[] = [
  { id: "T-01", task: "Low-Fidelity Wireframe", description: "Create a Low-Fidelity Wireframe for a new candidate intake flow", assignees: ["Zara Khan", "Rahul Nair"], dueAt: daysFromNow(3), ring: "todo" },
  { id: "T-02", task: "Visual Style Guide", description: "Design a Visual Style Guide including type, colour and spacing tokens", assignees: ["Kavya Iyer", "Zara Khan", "Harish Rao"], dueAt: daysFromNow(4), ring: "todo" },
  { id: "T-03", task: "Interactive Prototype", description: "Develop Interactive Prototypes using the resume builder as the anchor flow", assignees: ["Zara Khan"], dueAt: daysFromNow(5), ring: "todo" },
  { id: "T-04", task: "UI/UX Audit", description: "Conduct a UI/UX Audit on an existing bench-sales workflow", assignees: ["Rahul Nair"], dueAt: daysFromNow(6), ring: "todo" },
  { id: "T-05", task: "Responsive Layout", description: "Design a Responsive Layout that adapts from 1440px down to 390px", assignees: ["Tara Sen"], dueAt: daysFromNow(7), ring: "todo" },
  { id: "T-06", task: "REST API Endpoint", description: "Implement a REST API Endpoint for resume export status", assignees: ["Zara Khan", "Rahul Nair"], dueAt: daysFromNow(8), ring: "in-progress" },
  { id: "T-07", task: "User Authentication System", description: "Build a User Authentication System with role-based access", assignees: ["Kavya Iyer", "Zara Khan", "Harish Rao"], dueAt: daysFromNow(9), ring: "in-progress" },
  { id: "T-08", task: "Optimize Frontend Performance", description: "Create Frontend Performance Wireframes and a budget for load time", assignees: ["Zara Khan"], dueAt: daysFromNow(10), ring: "in-progress" },
  { id: "T-09", task: "Unit and Integration Tests", description: "Write Unit and Integration Tests to ensure export-gate reliability", assignees: ["Zara Khan", "Rahul Nair"], dueAt: daysFromNow(11), ring: "in-progress" },
];
const COLUMNS: ColumnDef<TaskRow, unknown>[] = [
  { accessorKey: "task", header: "Task", cell: ({ row }) => <div className="flex items-center gap-2.5"><StatusRing state={row.original.ring} /><span className="text-body-strong whitespace-nowrap">{row.original.task}</span></div> },
  { accessorKey: "description", header: "Description", cell: ({ getValue }) => <span className="block max-w-80 truncate text-[var(--color-text-2)]">{String(getValue())}</span> },
  { accessorKey: "assignees", header: "Assignee", enableSorting: false, cell: ({ row }) => <AvatarStack people={row.original.assignees.map((name) => ({ name }))} /> },
  { accessorKey: "dueAt", header: "Due Date", cell: ({ getValue }) => <span className="whitespace-nowrap text-[var(--color-text-2)]">{formatDueDate(String(getValue()))}</span> },
];
const TABS = ["Overview", "Foundations", "Patterns", "Interactive lab"] as const;
type Tab = typeof TABS[number];

/** Dev-only (docs/07 A7): not found in production unless NEXT_PUBLIC_SHOW_DEV_ROUTES=true. */
export default function DesignSystemPage() {
  if (!devRoutesEnabled()) notFound();
  return <ShowcasePage />;
}

function ShowcasePage() {
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [density, setDensity] = useState<Density>("default");
  const [rows, setRows] = useState(INITIAL_ROWS);
  const [notice, setNotice] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);

  function downloadTokens() {
    const styles = getComputedStyle(document.documentElement);
    const keys = ["--color-bg", "--color-surface", "--color-text", "--color-text-2", "--color-border", "--color-primary", "--gradient-primary", "--gradient-brand", "--gradient-glass", "--font-sans", "--font-mono", "--control-height", "--row-default", "--sidebar-width"];
    const tokens = Object.fromEntries(keys.map((key) => [key, styles.getPropertyValue(key).trim()]));
    const url = URL.createObjectURL(new Blob([JSON.stringify(tokens, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "benchq-tokens.json";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Theme tokens exported.");
  }

  return (
    <div className="bq-page space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5"><h1 className="text-h1">Design system</h1><Tag>v3.0</Tag></div>
          <p className="mt-1 text-body text-[var(--color-text-3)]">The foundations of a quieter, more focused workspace.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={downloadTokens}><Download size={14} aria-hidden />Export tokens</Button>
          <Button onClick={() => dialogRef.current?.showModal()}><Plus size={14} aria-hidden />Preview dialog</Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="bq-tabs" role="tablist" aria-label="Design system sections">
          {TABS.map((tab, index) => <button key={tab} role="tab" id={`tab-${index}`} aria-controls="design-panel" aria-selected={activeTab === tab} tabIndex={activeTab === tab ? 0 : -1} onClick={() => setActiveTab(tab)} onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
            setActiveTab(TABS[next]); document.getElementById(`tab-${next}`)?.focus();
          }}>{tab}</button>)}
        </div>
        <span className="text-mono-sm text-[var(--color-text-3)]">COMPACT BY DEFAULT</span>
      </div>

      {notice ? <div role="status" className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-success-bg)] px-3 py-2 text-sm text-[var(--color-success-fg)]"><Check size={14} aria-hidden />{notice}<button aria-label="Dismiss notification" className="ml-auto p-1" onClick={() => setNotice("")}><X size={13} /></button></div> : null}

      <div id="design-panel" role="tabpanel" aria-labelledby={`tab-${TABS.indexOf(activeTab)}`} tabIndex={0} className="space-y-6">
        {activeTab === "Overview" ? <>
          <section aria-label="Density specifications" className="bq-card grid grid-cols-2 lg:grid-cols-4 divide-x divide-[var(--color-border)]">
            {[["Body text", "13", "px / 20px line height"], ["Controls", "32", "px / default height"], ["Table rows", "36", "px / balanced density"], ["Spacing", "4", "px / base unit"]].map(([label, value, detail]) => <div key={label} className="px-5 py-4"><p className="text-sm text-[var(--color-text-2)]">{label}</p><div className="flex items-baseline gap-2 mt-1"><span className="text-h1 tabular">{value}</span><span className="text-caption text-[var(--color-text-3)]">{detail}</span></div></div>)}
          </section>

          <section aria-labelledby="table-title">
            <div className="bq-section-heading">
              <div><h2 id="table-title" className="text-h2">Tables & lists</h2><p className="mt-1">Soft headers, precise alignment, and room for the work. Sample data.</p></div>
              <div className="flex items-center gap-2 text-sm text-[var(--color-text-2)]"><SlidersHorizontal size={13} aria-hidden /><Select aria-label="Table density" className="w-32" value={density} onValueChange={(value) => setDensity(value as Density)} options={[{ value: "compact", label: "Compact", description: "32px rows" }, { value: "default", label: "Default", description: "36px rows" }, { value: "comfortable", label: "Comfortable", description: "44px rows" }]} /></div>
            </div>
            <DataTable columns={COLUMNS} data={rows} getRowId={(row) => row.id} density={density} isRowSelectable={false} searchPlaceholder="Search tasks…" storageKey="design-v3-tasks" pagination pageSize={5} />
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Buttons & actions</CardTitle><span className="text-mono-sm text-[var(--color-text-3)]">01 / CONTROLS</span></CardHeader>
              <p className="text-sm text-[var(--color-text-3)] mb-4">A subtle highlight. A little depth. One clear primary action.</p>
              <div className="flex flex-wrap items-center gap-2"><Button onClick={() => dialogRef.current?.showModal()}><Plus size={14} aria-hidden />Add candidate</Button><Button variant="secondary" onClick={downloadTokens}><Download size={14} aria-hidden />Export</Button><Button variant="ghost" onClick={() => setNotice("Ghost action previewed.")}>View details<ArrowUpRight size={13} aria-hidden /></Button><Button disabled>Disabled</Button></div>
              <div className="mt-4 pt-3 border-t border-[var(--color-border)] flex items-center flex-wrap gap-2"><Button size="sm" onClick={() => setNotice("Compact button · 28px.")}>Small</Button><Button variant="secondary" onClick={() => setNotice("Default button · 32px.")}>Default</Button><Button variant="subtle" onClick={() => setNotice("Subtle action previewed.")}>Subtle</Button><Button variant="danger" size="sm" onClick={() => setNotice("Destructive button preview only. No data was deleted.")}>Remove</Button><span className="ml-auto text-mono-sm text-[var(--color-text-3)]">28 / 32 / 36</span></div>
            </Card>
            <Card>
              <CardHeader><CardTitle>Tags & status</CardTitle><span className="text-mono-sm text-[var(--color-text-3)]">02 / METADATA</span></CardHeader>
              <p className="text-sm text-[var(--color-text-3)] mb-4">JetBrains Mono. Soft color, fine borders, explicit meaning.</p>
              <div className="flex flex-wrap gap-2"><Tag tone="green">Available</Tag><Tag tone="blue">In progress</Tag><Tag tone="amber">In review</Tag><Tag tone="violet">Interview</Tag><Tag tone="red">Blocked</Tag><Tag tone="teal">Remote</Tag><Tag>On hold</Tag></div>
              <div className="mt-4 pt-3 border-t border-[var(--color-border)] flex flex-wrap items-center gap-2"><ClaimChip state="VERIFIED" /><ClaimChip state="UNVERIFIED" /><ClaimChip state="CONTRADICTED" /><span className="ml-auto text-caption text-[var(--color-text-3)]">Evidence states stay distinct</span></div>
            </Card>
          </div>
          <DesignPatterns compact />
        </> : null}
        {activeTab === "Foundations" ? <DesignFoundations /> : null}
        {activeTab === "Patterns" ? <DesignPatterns /> : null}
        {activeTab === "Interactive lab" ? <StageOneShowcase /> : null}
      </div>

      <footer className="flex flex-wrap justify-between gap-2 border-t border-[var(--color-border)] pt-4 text-caption text-[var(--color-text-3)]"><span>BenchQ / Interface system</span><span>Host Grotesk + JetBrains Mono · Light & dark · Keyboard ready</span></footer>

      <dialog ref={dialogRef} aria-labelledby="candidate-dialog-title" className="bq-dialog" onClick={(event) => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialogRef.current?.close(); } }}>
        <form onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const name = String(form.get("name")).trim();
          if (!name) return;
          const role = String(form.get("role")).trim() || "Not specified";
          setRows((current) => [...current, { id: `demo-${Date.now()}`, task: name, description: `${role} — added from the design-system preview form`, assignees: ["Zara Khan"], dueAt: daysFromNow(5), ring: "todo" }]);
          dialogRef.current?.close(); event.currentTarget.reset(); setActiveTab("Overview"); setNotice(`${name} added to the sample table. Demo only; no external data is saved.`);
        }}>
          <div className="flex justify-between items-center mb-2"><h2 id="candidate-dialog-title" className="text-h2">Add a task</h2><Button variant="ghost" size="icon" aria-label="Close dialog" onClick={() => dialogRef.current?.close()}><X size={16} /></Button></div>
          <p className="text-body text-[var(--color-text-3)] mb-5">Preview a compact form. This only updates the sample table.</p>
          <label className="block text-sm mb-4">Task name<Input name="name" required maxLength={80} autoFocus placeholder="e.g. Accessibility pass" className="mt-1.5" /></label>
          <label className="block text-sm mb-5">Context<Input name="role" maxLength={80} placeholder="e.g. Resume builder" className="mt-1.5" /></label>
          <div className="flex justify-end gap-2 border-t border-[var(--color-border)] pt-4"><Button variant="secondary" onClick={() => dialogRef.current?.close()}>Cancel</Button><Button type="submit"><Plus size={14} aria-hidden />Add task</Button></div>
        </form>
      </dialog>
    </div>
  );
}
