"use client";

import { Gauge } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/ui/section-card";
import { useSaveAiLimits } from "@/lib/hooks/use-ai-presets";
import type { AiSetup } from "@/lib/schemas/ai-presets";
import { Field, errorMessage, fieldAria } from "../admin-dialog";
import { ErrorNote } from "@/components/app/error-note";

const parseLimit = (value: string) => (/^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN);
const isLimit = (value: number) => Number.isInteger(value) && value >= 1 && value <= 200;

/** How many tailorings and parses run at once in each backend process; extra ones wait. Applies without a restart. */
export function LimitsCard({ limits, canEdit }: { limits: AiSetup["limits"]; canEdit: boolean }) {
  const save = useSaveAiLimits();
  const [tailor, setTailor] = useState(String(limits.resumeTailor));
  const [parse, setParse] = useState(String(limits.resumeParse));
  const next = { resumeTailor: parseLimit(tailor), resumeParse: parseLimit(parse) };
  const isValid = isLimit(next.resumeTailor) && isLimit(next.resumeParse);
  const isChanged = next.resumeTailor !== limits.resumeTailor || next.resumeParse !== limits.resumeParse;

  return (
    <SectionCard icon={Gauge} title="Running at once">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="ai-limit-tailor" label="Résumé tailoring" hint="Per backend process">
            <Input {...fieldAria("ai-limit-tailor", null, true)} inputMode="numeric" value={tailor} disabled={!canEdit} onChange={(event) => setTailor(event.target.value)} />
          </Field>
          <Field id="ai-limit-parse" label="Résumé parser" hint="Per backend process">
            <Input {...fieldAria("ai-limit-parse", null, true)} inputMode="numeric" value={parse} disabled={!canEdit} onChange={(event) => setParse(event.target.value)} />
          </Field>
        </div>
        {!isValid ? <p role="alert" className="text-sm text-[var(--color-danger-fg)]">Enter a whole number from 1 to 200.</p> : null}
        <ErrorNote text={errorMessage(save.error)} />
        {canEdit ? <Button disabled={!isValid || !isChanged || save.isPending} onClick={() => save.mutate(next)}>{save.isPending ? "Saving…" : "Save limits"}</Button> : null}
      </div>
    </SectionCard>
  );
}
