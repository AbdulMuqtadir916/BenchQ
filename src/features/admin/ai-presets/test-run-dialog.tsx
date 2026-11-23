"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import type { TestSample } from "@/lib/api/ai-presets";
import { useAiTestRun } from "@/lib/hooks/use-ai-presets";
import type { AiPreset, AiUseCase } from "@/lib/schemas/ai-presets";
import { AdminDialog, Field, errorMessage, fieldAria } from "../admin-dialog";

type SampleField = { name: keyof TestSample; label: string; isLong?: boolean };

const FIELDS: Record<string, SampleField[]> = {
  resume_parse: [{ name: "resume", label: "Sample résumé text", isLong: true }],
  resume_tailor: [{ name: "resume", label: "Sample résumé text", isLong: true }, { name: "posting", label: "Sample job posting", isLong: true }],
  search_titles: [{ name: "targetRole", label: "Target role" }],
  email_classification: [{ name: "subject", label: "Sample subject" }, { name: "body", label: "Sample email", isLong: true }],
};

/** A preset on a pasted sample (08 Q7): no firm data, nothing saved, the cost logged as a platform test. */
export function TestRunDialog({ useCase, preset, onClose }: { useCase: AiUseCase; preset: AiPreset; onClose: () => void }) {
  const run = useAiTestRun(preset.id);
  const [sample, setSample] = useState<TestSample>({});
  const fields = FIELDS[useCase.key] ?? [];
  const isReady = fields.every((field) => sample[field.name]?.trim());

  return (
    <AdminDialog
      open
      wide
      onClose={onClose}
      title={`Test ${preset.name}`}
      description={<p>Use made-up or anonymized text. Nothing is saved.{useCase.key === "resume_tailor" ? " This runs the first tailoring step." : ""}</p>}
      confirmLabel="Run test"
      pendingLabel="Running…"
      isPending={run.isPending}
      canConfirm={isReady}
      error={errorMessage(run.error)}
      onConfirm={() => run.mutate(sample)}
    >
      {fields.map((field) => {
        const id = `test-${field.name}`;
        const value = sample[field.name] ?? "";
        const change = (next: string) => setSample((current) => ({ ...current, [field.name]: next }));
        return (
          <Field key={field.name} id={id} label={field.label}>
            {field.isLong
              ? <textarea {...fieldAria(id)} rows={6} value={value} onChange={(event) => change(event.target.value)} className="bq-input h-auto w-full py-2" />
              : <Input {...fieldAria(id)} value={value} onChange={(event) => change(event.target.value)} />}
          </Field>
        );
      })}
      {run.isSuccess ? (
        <div className="space-y-1.5">
          <p className="text-label text-[var(--color-text-2)]">Output</p>
          <pre tabIndex={0} className="max-h-64 overflow-auto rounded-[var(--radius-md)] bg-[var(--color-surface-2)] p-2 font-mono text-caption">{JSON.stringify(run.data, null, 2)}</pre>
        </div>
      ) : null}
    </AdminDialog>
  );
}
