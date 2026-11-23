"use client";

import { Boxes, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/ui/section-card";
import { Tag } from "@/components/ui/tag";
import { useAddAiModel, useAvailableAiModels, useHideAiModel } from "@/lib/hooks/use-ai-presets";
import type { AiModel } from "@/lib/schemas/ai-presets";
import { errorMessage } from "../admin-dialog";
import { ErrorNote } from "@/components/app/error-note";

const MOST_SHOWN = 8;

/** The approved models. New ones come only from OpenRouter's live list; one an active preset uses can't be removed. */
export function ModelsCard({ models, canEdit }: { models: AiModel[]; canEdit: boolean }) {
  const add = useAddAiModel();
  const hide = useHideAiModel();
  const [isAdding, setIsAdding] = useState(false);
  const [query, setQuery] = useState("");
  const live = useAvailableAiModels(isAdding);
  const approved = useMemo(() => new Set(models.filter((model) => !model.isHidden).map((model) => model.modelId)), [models]);
  const matches = useMemo(() => {
    const words = query.trim().toLowerCase();
    if (!words) return [];
    return (live.data ?? []).filter((model) => !approved.has(model.id) && `${model.id} ${model.name}`.toLowerCase().includes(words)).slice(0, MOST_SHOWN);
  }, [approved, live.data, query]);
  const error = errorMessage(add.error) ?? errorMessage(hide.error);

  return (
    <SectionCard
      icon={Boxes}
      title="Approved models"
      action={canEdit ? <Button variant="secondary" size="sm" onClick={() => setIsAdding((value) => !value)}><Plus size={13} aria-hidden /> Add model</Button> : undefined}
    >
      <div className="space-y-3">
        <ul className="flex flex-wrap gap-2">
          {models.filter((model) => !model.isHidden).map((model) => (
            <li key={model.id} className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] py-1 pl-2 pr-1 text-sm">
              <span className="font-mono text-caption">{model.modelId}</span>
              {model.inUse ? <Tag tone="green">In use</Tag> : canEdit ? (
                <button type="button" aria-label={`Remove ${model.modelId}`} disabled={hide.isPending} onClick={() => hide.mutate(model.id)} className="rounded-[var(--radius-sm)] p-0.5 text-[var(--color-text-3)] hover:text-[var(--color-danger-fg)]"><X size={13} aria-hidden /></button>
              ) : null}
            </li>
          ))}
        </ul>
        {isAdding ? (
          <div className="space-y-2">
            <Input aria-label="Search OpenRouter models" placeholder="Search OpenRouter's models…" value={query} onChange={(event) => setQuery(event.target.value)} />
            {live.isPending ? <p className="text-caption text-[var(--color-text-3)]">Loading models…</p> : null}
            <ErrorNote text={errorMessage(live.error)} />
            {query.trim() && live.isSuccess && matches.length === 0 ? <p className="text-caption text-[var(--color-text-3)]">No models match.</p> : null}
            {matches.length > 0 ? (
              <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-md)] border border-[var(--color-border)]">
                {matches.map((model) => (
                  <li key={model.id} className="flex items-center justify-between gap-2 px-2 py-1.5">
                    <span className="min-w-0 truncate text-sm">{model.name} <span className="font-mono text-caption text-[var(--color-text-3)]">{model.id}</span></span>
                    <Button variant="ghost" size="sm" disabled={add.isPending} onClick={() => add.mutate(model.id)}>Add</Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <ErrorNote text={error} />
      </div>
    </SectionCard>
  );
}
