"use client";

import { useState } from "react";
import { Check, Circle, Clock3, FileText, Mail, TriangleAlert } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tag, type TagTone } from "@/components/ui/tag";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/app/empty-state";
import { SkeletonList } from "@/components/app/skeleton-list";
import { SectionCard } from "@/components/ui/section-card";
import { MergeField } from "@/components/ui/merge-field";
import { Select } from "@/components/ui/select";
import { CandidateStatusSelect, type CandidateStatusFilter } from "@/components/app/candidate-status-select";

const COLORS = [
  ["Workspace", "--color-surface", "#FFFFFF"], ["Canvas", "--color-bg", "#E9EAED"],
  ["Subtle", "--color-surface-2", "#F8F8FA"], ["Border", "--color-border", "#E9EAEE"],
  ["Primary", "--color-primary", "#3458E5"], ["Text", "--color-text", "#202126"],
  ["Secondary", "--color-text-2", "#555861"], ["Muted", "--color-text-3", "#707480"],
];
const GRADIENTS = [
  ["Primary", "--gradient-primary", "Actions"], ["Brand", "--gradient-brand", "Identity"],
  ["Glass", "--gradient-glass", "App frame"], ["Neutral", "--gradient-neutral", "Controls"],
  ["Mint", "--gradient-mint", "Success accent"], ["Amber", "--gradient-amber", "Review accent"],
  ["Violet", "--gradient-violet", "Category accent"],
];
export function DesignFoundations() {
  return <div className="space-y-6">
    <section>
      <div className="bq-section-heading"><h2 className="text-h2">Color system</h2><p>Neutral surfaces. Purposeful accents.</p></div>
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">{COLORS.map(([name, token, value]) => <div key={token} className="bq-card overflow-hidden"><div className="h-16 border-b border-[var(--color-border)]" style={{ background: `var(${token})` }} /><div className="p-3"><p className="text-sm font-medium">{name}</p><p className="text-mono-sm text-[var(--color-text-3)] mt-1">{value}</p></div></div>)}</div>
      <p className="mt-2 text-caption text-[var(--color-text-3)]">Hex values describe the light palette; swatches follow the current theme.</p>
    </section>
    <section>
      <div className="bq-section-heading"><h2 className="text-h2">Gradient library</h2><p>Surface treatments, not decoration.</p></div>
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">{GRADIENTS.map(([name, token, usage]) => <div key={token} className="bq-card overflow-hidden"><div className="h-20 border-b border-[var(--color-border)]" style={{ background: `var(${token})` }} /><div className="p-3"><p className="text-sm font-medium">{name}</p><p className="text-caption text-[var(--color-text-3)]">{usage}</p></div></div>)}</div>
    </section>
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <Card><CardHeader><CardTitle>Typography</CardTitle><Tag>Host Grotesk</Tag></CardHeader>
        {[["text-display", "28 / 34", "Clear at a glance"], ["text-h1", "22 / 28", "Everything in its place"], ["text-h2", "17 / 24", "A focused workspace"], ["text-h3", "14 / 20", "Candidate overview"], ["text-body", "13 / 20", "Designed for the details of everyday work."], ["text-sm", "12 / 18", "Compact tables and supporting information"], ["text-caption", "11 / 16", "Last updated 2 minutes ago"], ["text-mono-sm", "10 / 16", "BQ-1024 · AVAILABLE"]].map(([cls, size, sample]) => <div key={cls} className="grid grid-cols-[64px_1fr] items-baseline gap-3 py-3 border-b last:border-0 border-[var(--color-border)]"><span className="text-mono-sm text-[var(--color-text-3)]">{size}</span><p className={cls}>{sample}</p></div>)}
      </Card>
      <div className="space-y-4">
        <Card><CardHeader><CardTitle>Spacing & shape</CardTitle><Tag>4px grid</Tag></CardHeader><p className="text-sm text-[var(--color-text-3)] mb-4">Use space to group information, not to inflate the interface.</p><div className="flex flex-wrap gap-2">{[4, 8, 12, 16, 20, 24, 32, 48].map((n) => <Tag key={n}>{n}px</Tag>)}</div><div className="grid grid-cols-4 gap-3 mt-5">{[["6", "--radius-sm"], ["8", "--radius-md"], ["12", "--radius-lg"], ["16", "--radius-xl"]].map(([n, token]) => <div key={n} className="h-14 flex items-center justify-center border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-mono-sm" style={{ borderRadius: `var(${token})` }}>{n}px</div>)}</div></Card>
        <Card><CardHeader><CardTitle>Elevation</CardTitle><span className="text-caption text-[var(--color-text-3)]">Low contrast, never flat</span></CardHeader><div className="grid grid-cols-3 gap-3 py-3">{[["Contact", "--shadow-xs"], ["Raised", "--shadow-sm"], ["Overlay", "--shadow-md"]].map(([name, token]) => <div key={token} className="bq-card py-5 text-center text-sm" style={{ boxShadow: `var(${token})` }}>{name}</div>)}</div></Card>
        <Card><CardHeader><CardTitle>Motion & accessibility</CardTitle></CardHeader><p className="text-sm text-[var(--color-text-2)]">100–200ms for controls. Reduced motion is respected. Focus rings remain visible. State is always expressed with text, never color alone.</p></Card>
      </div>
    </div>
  </div>;
}

export function DesignPatterns({ compact = false }: { compact?: boolean }) {
  const [notifications, setNotifications] = useState(true);
  const [saved, setSaved] = useState(false);
  const [defaultView, setDefaultView] = useState("list");
  const [candidateStatus, setCandidateStatus] = useState<CandidateStatusFilter>("ALL");
  return <div className="space-y-5">
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Inputs & preferences</CardTitle><span className="text-mono-sm text-[var(--color-text-3)]">04 / FORMS</span></CardHeader>
        <form onSubmit={(event) => { event.preventDefault(); setSaved(true); }} onChange={() => setSaved(false)}>
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Workspace name<Input defaultValue="BenchQ workspace" required className="mt-1.5" /></label><div><p className="text-sm">Default view</p><Select className="mt-1.5" aria-label="Default view" value={defaultView} onValueChange={(value) => { setDefaultView(value); setSaved(false); }} options={[{ value: "list", label: "List view", description: "Structured rows" }, { value: "board", label: "Board view", description: "Stage-based workflow" }, { value: "calendar", label: "Calendar", description: "Dates and deadlines" }]} /></div></div>
          <div className="mt-3"><p className="text-sm">Candidate status</p><CandidateStatusSelect className="mt-1.5 w-full sm:w-48" value={candidateStatus} onValueChange={(value) => { setCandidateStatus(value); setSaved(false); }} /></div>
          <div className="flex items-center justify-between gap-3 mt-4 py-3 border-y border-[var(--color-border)]"><div><p className="text-body-strong">Follow-up reminders</p><p className="text-caption text-[var(--color-text-3)]">Stay on top of your candidate pipeline.</p></div><button type="button" role="switch" aria-checked={notifications} aria-label="Follow-up reminders" className="bq-switch" onClick={() => { setNotifications((current) => !current); setSaved(false); }}><span /></button></div>
          <div className="mt-3 flex flex-wrap justify-between items-center gap-3"><label className="flex items-center gap-2 text-sm text-[var(--color-text-2)]"><Checkbox defaultChecked />Use compact density</label><Button type="submit" size="sm">{saved ? <Check size={13} aria-hidden /> : null}{saved ? "Saved locally" : "Save preferences"}</Button></div>
          <p role="status" className="text-caption text-[var(--color-text-3)] mt-2">{saved ? "Preview preferences updated for this session." : "Interactive preview · no account settings are changed."}</p>
        </form>
      </Card>
      <Card>
        <CardHeader><CardTitle>Surface hierarchy</CardTitle><span className="text-mono-sm text-[var(--color-text-3)]">04 / LAYERS</span></CardHeader>
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-glass-edge)] p-3" style={{ background: "var(--gradient-glass)" }}>
          <div className="bq-card p-4"><div className="flex items-center justify-between mb-3"><p className="text-body-strong">White workspace</p><Tag tone="blue">Base</Tag></div><p className="text-sm text-[var(--color-text-3)]">Content sits on an opaque surface. Frosted chrome stays outside the work area.</p><div className="mt-3 p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-2)] flex items-center gap-2 text-sm"><FileText size={14} className="text-[var(--color-text-3)]" aria-hidden />Quiet inset for supporting content</div></div>
        </div>
      </Card>
    </div>
    {!compact ? <>
      <section><div className="bq-section-heading"><h2 className="text-h2">Board cards</h2><p>Neutral wells, compact cards, status-led color.</p></div><div className="grid gap-3 lg:grid-cols-3">{([
        ["In progress", "blue", "Review candidate profile", "Confirm the latest experience and availability.", "--gradient-neutral"],
        ["In review", "amber", "Review the resume", "Read it over before you send it.", "--gradient-amber"],
        ["Completed", "green", "Application submitted", "Candidate approved the final version.", "--gradient-mint"],
      ] as const).map(([status, tone, title, description, gradient]) => <div key={status} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2"><div className="flex justify-between items-center p-2 rounded-[var(--radius-md)] mb-2" style={{ background: `var(${gradient})` }}><Tag tone={tone as TagTone}>{status}</Tag><span className="text-mono-sm text-[var(--color-text-3)]">1</span></div><Card><span className="text-mono-sm text-[var(--color-text-3)]">BQ-1024</span><h3 className="text-h3 mt-3">{title}</h3><p className="text-sm text-[var(--color-text-3)] mt-1">{description}</p><div className="flex justify-between mt-4 pt-3 border-t border-[var(--color-border)]"><Tag><Clock3 size={11} aria-hidden />Today</Tag><span className="text-caption text-[var(--color-text-2)]">Priya R.</span></div></Card></div>)}</div></section>
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Outreach preview" icon={Mail}><p className="text-body mb-3">Hi <MergeField>First name</MergeField>,</p><p className="text-body text-[var(--color-text-2)]">Following up on the engineering role at <MergeField>Company</MergeField>. Would you have time for a short call this week?</p><details className="mt-4 pt-3 border-t border-[var(--color-border)]"><summary className="text-sm text-[var(--color-text-2)]">Template details</summary><p className="text-caption text-[var(--color-text-3)] mt-2">Merge fields resolve from the selected contact before sending.</p></details></SectionCard>
        <Card><CardHeader><CardTitle>Feedback & validation</CardTitle></CardHeader><label className="text-sm">Email address<Input defaultValue="priya@" aria-invalid="true" aria-describedby="email-error" className="mt-1.5" /></label><p id="email-error" className="text-caption text-[var(--color-danger-fg)] mt-1">Enter a complete email address.</p><div className="mt-4 flex gap-2 rounded-[var(--radius-md)] p-3 bg-[var(--color-warning-bg)] text-[var(--color-warning-fg)]"><TriangleAlert size={15} className="shrink-0 mt-0.5" aria-hidden /><div><p className="text-body-strong">Check this field</p><p className="text-sm">Fix the highlighted field before you continue.</p></div></div></Card>
      </div>
      <section className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle>Loading</CardTitle><Circle size={12} aria-hidden /></CardHeader><SkeletonList rows={3} /></Card><Card><EmptyState icon={FileText} title="Nothing here yet" description="New documents will appear here when they are added." variant="first-run" /></Card></section>
    </> : null}
  </div>;
}
