"use client";

import { useMemo, useState } from "react";
import { Check, Clock, X, Link2, Mail, PencilRuler } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { FollowUpTask } from "@/lib/schemas/application";
import type { FollowUpKind } from "@/lib/schemas/enums";
import { useFollowups } from "@/lib/hooks/use-applications";
import { useSession } from "@/lib/stores/session-store";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { DualTimestamp } from "@/components/app/dual-timestamp";
import { EmptyState } from "@/components/app/empty-state";
import { SkeletonList } from "@/components/app/skeleton-list";
import { BellOff } from "lucide-react";

const KIND_META: Record<FollowUpKind, { label: string; Icon: typeof Mail }> = {
  DAY_3_LINKEDIN: { label: "Day-3 LinkedIn", Icon: Link2 },
  DAY_7_EMAIL: { label: "Day-7 email", Icon: Mail },
  CUSTOM: { label: "Custom", Icon: PencilRuler },
};

type Bucket = "overdue" | "today" | "week" | "later";

function bucketOf(f: FollowUpTask): Bucket {
  const due = new Date(f.dueAt);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endToday = new Date(startToday.getTime() + 86_400_000);
  if (due < startToday) return "overdue";
  if (due < endToday) return "today";
  if (due < new Date(startToday.getTime() + 7 * 86_400_000)) return "week";
  return "later";
}

const BUCKETS: { key: Bucket; label: string; tone: "red" | "amber" | "blue" | "neutral" }[] = [
  { key: "overdue", label: "Overdue", tone: "red" },
  { key: "today", label: "Today", tone: "amber" },
  { key: "week", label: "This week", tone: "blue" },
  { key: "later", label: "Later", tone: "neutral" },
];

export default function FollowupsPage() {
  const { user } = useSession();
  const followupsQuery = useFollowups(user.role === "BDE" ? user.id : undefined);
  const [done, setDone] = useState<Set<string>>(new Set());
  const canAct = user.role !== "VIEWER";

  const pending = useMemo(
    () => (followupsQuery.data ?? []).filter((f) => f.state === "PENDING" && !done.has(f.id)),
    [followupsQuery.data, done],
  );

  const grouped = useMemo(() => {
    const map: Record<Bucket, FollowUpTask[]> = { overdue: [], today: [], week: [], later: [] };
    for (const f of pending) map[bucketOf(f)].push(f);
    return map;
  }, [pending]);

  function complete(id: string) {
    setDone((prev) => new Set(prev).add(id));
  }

  return (
    <div className="bq-page">
      <PageHeader title="Follow-ups" subtitle="Day-3 LinkedIn, day-7 email — generated when an application is sent." />

      {followupsQuery.isLoading ? (
        <Card className="p-0"><SkeletonList rows={6} /></Card>
      ) : pending.length === 0 ? (
        <EmptyState icon={BellOff} title="Nothing due" description="Every follow-up is handled. New ones appear as applications go out." variant="first-run" />
      ) : (
        <div className="space-y-6">
          {BUCKETS.map(({ key, label, tone }) => {
            const items = grouped[key];
            if (items.length === 0) return null;
            return (
              <section key={key}>
                <div className="mb-2 flex items-center gap-2">
                  <Tag tone={tone}>{label}</Tag>
                  <span className="text-caption text-[var(--color-text-3)]">{items.length}</span>
                </div>
                <Card className="p-0">
                  <ul className="divide-y divide-[var(--color-border)]">
                    <AnimatePresence initial={false}>
                      {items.map((f) => {
                        const { label: kindLabel, Icon } = KIND_META[f.kind];
                        return (
                          <motion.li key={f.id} layout exit={{ opacity: 0, height: 0 }} className="flex items-center gap-3 px-4 py-3">
                            <Icon size={16} className="shrink-0 text-[var(--color-text-3)]" aria-hidden />
                            <div className="min-w-0 flex-1">
                              <div className="text-body-strong text-sm truncate">{f.candidateName}</div>
                              <div className="text-caption text-[var(--color-text-3)] truncate">{kindLabel} · {f.jobTitle} at {f.companyName}</div>
                            </div>
                            <span className="hidden shrink-0 text-caption text-[var(--color-text-3)] sm:block">due <DualTimestamp iso={f.dueAt} format="relative" /></span>
                            {canAct ? (
                              <div className="flex shrink-0 items-center gap-1">
                                <Button size="sm" variant="secondary" onClick={() => complete(f.id)}><Check size={13} aria-hidden />Done</Button>
                                <Button size="icon" variant="ghost" aria-label="Snooze" onClick={() => complete(f.id)}><Clock size={14} aria-hidden /></Button>
                                <Button size="icon" variant="ghost" aria-label="Cancel" onClick={() => complete(f.id)}><X size={14} aria-hidden /></Button>
                              </div>
                            ) : null}
                          </motion.li>
                        );
                      })}
                    </AnimatePresence>
                  </ul>
                </Card>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
