"use client";

import { useState } from "react";
import { Check, Copy, CopyCheck, MessageSquareQuote } from "lucide-react";
import type { QaBankEntry } from "@/lib/schemas/candidate";
import { Card } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";

const CATEGORY: Record<QaBankEntry["category"], string> = {
  WORK_AUTH: "Visa",
  COMPENSATION: "Rate",
  AVAILABILITY: "Availability",
  RELOCATION: "Relocation",
  EXPERIENCE: "Experience",
  BEHAVIOURAL: "Behavioural",
  OTHER: "Other",
};

/** Answers to the questions every vendor form asks — copy instead of retyping them 30 times a night. */
export function ScreeningAnswers({ entries }: { entries: QaBankEntry[] }) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(key: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((k) => (k === key ? null : k)), 1600);
  }

  const all = entries.map((e) => `${e.question}\n${e.answer}`).join("\n\n");

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
        <h2 className="flex items-center gap-2 text-h3 text-[var(--color-text)]"><MessageSquareQuote size={15} aria-hidden className="text-[var(--color-text-3)]" />Screening answers</h2>
        {entries.length ? (
          <button type="button" onClick={() => void copy("all", all)} className="inline-flex items-center gap-1 text-sm text-[var(--color-primary-subtle-fg)] hover:underline">
            {copied === "all" ? <CopyCheck size={13} aria-hidden /> : <Copy size={13} aria-hidden />}{copied === "all" ? "Copied" : "Copy all"}
          </button>
        ) : null}
      </div>
      {entries.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[var(--color-text-3)]">No saved answers yet. Answers get saved here the first time you fill a vendor form.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {entries.map((e) => (
            <li key={e.id} className="group px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-[550] text-[var(--color-text)]">{e.question}</p>
                <button type="button" onClick={() => void copy(e.id, e.answer)} aria-label={`Copy answer: ${e.question}`} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-caption text-[var(--color-text-3)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]">
                  {copied === e.id ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}{copied === e.id ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="mt-0.5 text-sm text-[var(--color-text-2)]">{e.answer}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Tag>{CATEGORY[e.category]}</Tag>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
