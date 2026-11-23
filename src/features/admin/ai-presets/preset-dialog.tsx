"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api/client";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useCreateAiPreset, useEditAiPreset } from "@/lib/hooks/use-ai-presets";
import type { AiPreset, AiUseCase } from "@/lib/schemas/ai-presets";
import { AdminDialog, Field, errorMessage, fieldAria } from "../admin-dialog";
import { PromptField } from "./prompt-field";
import { promptProblem } from "./prompt-rules";

/** Create a preset, or edit one: a change to its model, effort or prompts saves a new version (08 Q5). */
export function PresetDialog({ useCase, efforts, preset, onClose }: { useCase: AiUseCase; efforts: string[]; preset: AiPreset | null; onClose: () => void }) {
  const create = useCreateAiPreset();
  const edit = useEditAiPreset(preset?.id ?? "");
  const mutation = preset ? edit : create;
  const starting = preset ?? useCase.presets.find((row) => row.isActive) ?? useCase.presets[0] ?? null;
  const [name, setName] = useState(preset?.name ?? "");
  const [notes, setNotes] = useState(preset?.notes ?? "");
  const [modelId, setModelId] = useState(starting?.current.modelId ?? useCase.modelIds[0] ?? "");
  const [effort, setEffort] = useState(starting?.current.effort ?? "");
  const [prompts, setPrompts] = useState<Record<string, string>>(() => ({ ...(starting?.current.prompts ?? {}) }));
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const isUnreachable = preset !== null && edit.error instanceof ApiError && edit.error.status === 409 && edit.error.message.includes("Save anyway");
  const modelIds = useCase.modelIds.includes(modelId) || !modelId ? useCase.modelIds : [modelId, ...useCase.modelIds];
  const problems = Object.fromEntries(useCase.prompts.map((spec) => [spec.name, promptProblem(spec, prompts[spec.name] ?? "")]));
  const nameError = name.trim() ? null : "Enter a name.";
  const isValid = !nameError && Boolean(modelId) && Object.values(problems).every((problem) => !problem);

  function submit(force = false) {
    setIsSubmitted(true);
    if (!isValid) return;
    const input = { name: name.trim(), notes: notes.trim(), modelId, effort, prompts };
    if (preset) edit.mutate({ ...input, force }, { onSuccess: onClose });
    else create.mutate({ ...input, module: useCase.key }, { onSuccess: onClose });
  }

  return (
    <AdminDialog
      open
      wide
      onClose={onClose}
      title={preset ? `Edit ${preset.name}` : `New ${useCase.label} preset`}
      description={preset?.isActive ? <p>This preset is active. A change applies to new runs only, after the model is tested.</p> : undefined}
      confirmLabel={isUnreachable ? "Save anyway" : preset ? "Save" : "Create preset"}
      pendingLabel="Saving…"
      isPending={mutation.isPending}
      error={errorMessage(mutation.error)}
      onConfirm={() => submit(isUnreachable)}
    >
      <Field id="preset-name" label="Name" error={isSubmitted ? nameError : null}>
        <Input {...fieldAria("preset-name", isSubmitted ? nameError : null)} value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="preset-model" label="Model">
          <Select value={modelId} options={modelIds.map((id) => ({ value: id, label: id }))} onValueChange={setModelId} aria-label="Model" />
        </Field>
        {useCase.takesEffort ? (
          <Field id="preset-effort" label="Reasoning effort">
            <Select value={effort} options={efforts.map((value) => ({ value, label: value || "Off" }))} onValueChange={setEffort} aria-label="Reasoning effort" />
          </Field>
        ) : null}
      </div>
      <Field id="preset-notes" label="Notes">
        <textarea {...fieldAria("preset-notes")} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} className="bq-input h-auto w-full py-2" />
      </Field>
      {useCase.prompts.map((spec) => (
        <PromptField
          key={spec.name}
          spec={spec}
          value={prompts[spec.name] ?? ""}
          error={isSubmitted ? problems[spec.name] : null}
          isEditing={editingPrompt === spec.name}
          onEdit={() => setEditingPrompt(spec.name)}
          onChange={(value) => setPrompts((current) => ({ ...current, [spec.name]: value }))}
        />
      ))}
    </AdminDialog>
  );
}
