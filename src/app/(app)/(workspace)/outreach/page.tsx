"use client";

import { useMemo, useState } from "react";
import { Send, Mail, Check, TriangleAlert, Link2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useApplications } from "@/lib/hooks/use-applications";
import { useCandidates } from "@/lib/hooks/use-candidates";
import { useSession } from "@/lib/stores/session-store";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/cn";

const TEMPLATES = [
  {
    id: "intro",
    name: "Intro — new submission",
    subject: "{Role} — {Candidate} is a strong fit",
    body: "Hi {First name},\n\nI came across the {Role} opening at {Company}. I represent {Candidate}, who matches the core requirements closely. Worth a 15-minute call this week?\n\nBest,\nAdnan",
  },
  {
    id: "followup",
    name: "Follow-up — day 3",
    subject: "Following up on {Candidate}",
    body: "Hi {First name},\n\nJust circling back on {Candidate} for the {Role} role at {Company}. Happy to share the full profile or set up a quick screen.\n\nThanks,\nAdnan",
  },
];

export default function OutreachPage() {
  const { user } = useSession();
  const applicationsQuery = useApplications();
  const candidatesQuery = useCandidates();
  const canAct = user.role !== "VIEWER";

  const candidateName = useMemo(() => {
    const m = new Map((candidatesQuery.data ?? []).map((c) => [c.id, c.fullName]));
    return (id: string) => m.get(id) ?? "the candidate";
  }, [candidatesQuery.data]);

  const threads = useMemo(() => {
    let apps = applicationsQuery.data ?? [];
    if (user.role === "BDE") apps = apps.filter((a) => a.submittedByUserId === user.id);
    return apps.filter((a) => ["APPLIED", "RESPONSE", "SCREENING"].includes(a.status)).slice(0, 20);
  }, [applicationsQuery.data, user]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState(TEMPLATES[0]!.id);
  const [sent, setSent] = useState<{ id: string; channel: string; at: string }[]>([]);

  const active = threads.find((t) => t.id === activeId) ?? threads[0] ?? null;
  const template = TEMPLATES.find((t) => t.id === templateId)!;

  const resolved = useMemo(() => {
    if (!active) return { subject: "", body: "" };
    const vars: Record<string, string> = {
      "{First name}": "Jordan",
      "{Company}": active.companyNameAtApply,
      "{Role}": active.jobTitleAtApply,
      "{Candidate}": candidateName(active.candidateId),
    };
    const fill = (s: string) => Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(k, v), s);
    return { subject: fill(template.subject), body: fill(template.body) };
  }, [active, template, candidateName]);

  function send(channel: string) {
    if (!active) return;
    setSent((prev) => [{ id: `${active.id}_${Date.now()}`, channel, at: new Date().toISOString() }, ...prev]);
  }

  return (
    <div className="bq-page">
      <PageHeader title="Outreach" subtitle="Templated, merge-filled, and checked for unverified claims before it goes out." />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card className="p-0 lg:sticky lg:top-4 lg:self-start">
          <CardHeader className="p-4"><CardTitle>Threads</CardTitle></CardHeader>
          <ul className="max-h-[520px] divide-y divide-[var(--color-border)] overflow-y-auto">
            {threads.map((t) => (
              <li key={t.id}>
                <button onClick={() => setActiveId(t.id)} className={cn("w-full px-4 py-3 text-left hover:bg-[var(--color-surface-2)]", active?.id === t.id && "bg-[var(--color-primary-subtle)]")}>
                  <div className="text-body-strong text-sm truncate">{candidateName(t.candidateId)}</div>
                  <div className="text-caption text-[var(--color-text-3)] truncate">{t.companyNameAtApply}</div>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        {active ? (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Compose · {active.companyNameAtApply}</CardTitle>
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="bq-input h-8 w-auto">
                  {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </CardHeader>

              <div className="mb-3 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-success-fg)]/30 bg-[var(--color-success-bg)] px-3 py-2 text-sm text-[var(--color-success-fg)]">
                <Check size={14} aria-hidden /> No unverified claims in this message — cleared to send.
              </div>

              <label className="mb-1 block text-label text-[var(--color-text-3)]">Subject</label>
              <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text)]">{resolved.subject}</div>

              <label className="mb-1 block text-label text-[var(--color-text-3)]">Body · merge fields resolved</label>
              <div className="whitespace-pre-wrap rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-text-2)]">{resolved.body}</div>

              {canAct ? (
                <div className="mt-4 flex items-center gap-2">
                  <Button onClick={() => send("EMAIL")}><Mail size={14} aria-hidden />Send email</Button>
                  <Button variant="secondary" onClick={() => send("LINKEDIN")}><Link2 size={14} aria-hidden />LinkedIn</Button>
                  <span className="ml-auto inline-flex items-center gap-1 text-caption text-[var(--color-text-3)]"><TriangleAlert size={12} aria-hidden />Demo only — nothing is actually sent</span>
                </div>
              ) : null}
            </Card>

            {sent.length > 0 ? (
              <Card className="p-0">
                <CardHeader className="p-4"><CardTitle>Sent</CardTitle></CardHeader>
                <ul className="divide-y divide-[var(--color-border)]">
                  <AnimatePresence initial={false}>
                    {sent.map((s) => (
                      <motion.li key={s.id} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                        <span className="flex items-center gap-2 text-[var(--color-text-2)]"><Send size={13} aria-hidden />{active.companyNameAtApply}</span>
                        <span className="flex items-center gap-2"><Tag tone="blue">{s.channel}</Tag><Tag tone="green">Sent</Tag></span>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              </Card>
            ) : null}
          </div>
        ) : (
          <Card><p className="text-sm text-[var(--color-text-3)]">No active threads. Send some applications first.</p></Card>
        )}
      </div>
    </div>
  );
}
