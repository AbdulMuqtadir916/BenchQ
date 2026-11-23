"use client";

import { Archive, ArchiveRestore, FlaskConical, Pencil, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import { Tag } from "@/components/ui/tag";
import { useActivateAiPreset, useArchiveAiPreset, useRestoreAiPreset } from "@/lib/hooks/use-ai-presets";
import type { AiPreset, AiUseCase } from "@/lib/schemas/ai-presets";
import { errorMessage } from "../admin-dialog";
import { PresetDialog } from "./preset-dialog";
import { TestRunDialog } from "./test-run-dialog";
import { ErrorNote } from "@/components/app/error-note";

type Open = { kind: "new" } | { kind: "edit"; preset: AiPreset } | { kind: "test"; preset: AiPreset } | null;

/** One AI use case: its presets, one active. Switching applies to new runs only. */
export function UseCaseCard({ useCase, efforts, canEdit }: { useCase: AiUseCase; efforts: string[]; canEdit: boolean }) {
  const activate = useActivateAiPreset();
  const archive = useArchiveAiPreset();
  const restore = useRestoreAiPreset();
  const [open, setOpen] = useState<Open>(null);
  const [lastActivated, setLastActivated] = useState("");
  const isUnreachable = activate.error instanceof ApiError && activate.error.status === 409 && Boolean(lastActivated);
  const presets = useCase.presets.filter((preset) => !preset.archivedAt);
  const archived = useCase.presets.filter((preset) => preset.archivedAt);
  const hasActive = presets.some((preset) => preset.isActive);
  const error = errorMessage(activate.error) ?? errorMessage(archive.error) ?? errorMessage(restore.error);

  return (
    <SectionCard
      icon={Sparkles}
      title={useCase.label}
      action={canEdit ? <Button variant="secondary" size="sm" onClick={() => setOpen({ kind: "new" })}><Plus size={13} aria-hidden /> New preset</Button> : undefined}
    >
      <div className="space-y-2">
        {!hasActive ? <p role="status" className="text-sm text-[var(--color-warning-fg)]">Needs setup: no active preset.</p> : null}
        <ul className="divide-y divide-[var(--color-border)]">
          {presets.map((preset) => (
            <li key={preset.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-body-strong text-[var(--color-text)]">{preset.name}</span>
                  <Tag>v{preset.current.version}</Tag>
                  {preset.isActive ? <Tag tone="green">Active</Tag> : null}
                </div>
                <p className="mt-0.5 truncate font-mono text-caption text-[var(--color-text-3)]">
                  {preset.current.modelId}{preset.current.effort ? ` · ${preset.current.effort}` : ""}
                </p>
              </div>
              {canEdit ? (
                <span className="inline-flex flex-wrap gap-1">
                  {!preset.isActive ? <Button variant="secondary" size="sm" disabled={activate.isPending} onClick={() => { setLastActivated(preset.id); activate.mutate({ id: preset.id }); }}>{activate.isPending && lastActivated === preset.id ? "Testing…" : "Make active"}</Button> : null}
                  <Button variant="ghost" size="sm" onClick={() => setOpen({ kind: "test", preset })}><FlaskConical size={13} aria-hidden /> Test</Button>
                  <Button variant="ghost" size="sm" onClick={() => setOpen({ kind: "edit", preset })}><Pencil size={13} aria-hidden /> Edit</Button>
                  {!preset.isActive ? <Button variant="ghost" size="sm" disabled={archive.isPending} onClick={() => archive.mutate(preset.id)}><Archive size={13} aria-hidden /> Archive</Button> : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        {archived.length ? (
          <details>
            <summary className="cursor-pointer text-caption text-[var(--color-text-3)]">Archived ({archived.length})</summary>
            <ul className="mt-1 divide-y divide-[var(--color-border)]">
              {archived.map((preset) => (
                <li key={preset.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="text-body text-[var(--color-text-2)]">{preset.name}</span>
                    <Tag>v{preset.current.version}</Tag>
                  </span>
                  {canEdit ? <Button variant="ghost" size="sm" disabled={restore.isPending} onClick={() => restore.mutate(preset.id)}><ArchiveRestore size={13} aria-hidden /> Restore</Button> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <ErrorNote text={error} />
        {isUnreachable ? <Button variant="secondary" size="sm" disabled={activate.isPending} onClick={() => activate.mutate({ id: lastActivated, force: true })}>Make active anyway</Button> : null}
      </div>
      {open?.kind === "test" ? <TestRunDialog useCase={useCase} preset={open.preset} onClose={() => setOpen(null)} /> : null}
      {open?.kind === "new" ? <PresetDialog useCase={useCase} efforts={efforts} preset={null} onClose={() => setOpen(null)} /> : null}
      {open?.kind === "edit" ? <PresetDialog useCase={useCase} efforts={efforts} preset={open.preset} onClose={() => setOpen(null)} /> : null}
    </SectionCard>
  );
}
