import { z } from "zod";
import type { AiSetup } from "@/lib/schemas/ai-presets";

const VersionDto = z.object({
  version: z.number().int(),
  model_id: z.string(),
  effort: z.string(),
  prompts: z.record(z.string(), z.string()),
  created_at: z.string(),
});

const PresetDto = z.object({
  id: z.string(),
  module: z.string(),
  name: z.string(),
  notes: z.string(),
  is_active: z.boolean(),
  archived_at: z.string().nullable(),
  current: VersionDto,
});

export const AiSetupDto = z.object({
  provider: z.object({
    provider: z.string(),
    key_set: z.boolean(),
    key_last4: z.string().nullable(),
    updated_at: z.string().nullable(),
  }),
  providers: z.array(z.object({ id: z.string(), label: z.string() })),
  models: z.array(z.object({
    id: z.string(), model_id: z.string(), label: z.string(), is_hidden: z.boolean(), in_use: z.boolean(),
  })),
  limits: z.object({ resume_tailor: z.number().int(), resume_parse: z.number().int() }),
  efforts: z.array(z.string()),
  modules: z.array(z.object({
    key: z.string(),
    label: z.string(),
    takes_effort: z.boolean(),
    prompts: z.array(z.object({
      name: z.string(), label: z.string(), placeholders: z.array(z.string()), optional: z.boolean(),
    })),
    model_ids: z.array(z.string()),
    presets: z.array(PresetDto),
  })),
});

export const AvailableModelsDto = z.array(z.object({ id: z.string(), name: z.string() }));
export const TestRunDto = z.object({ output: z.unknown() });

export function toAiSetup(dto: z.infer<typeof AiSetupDto>): AiSetup {
  return {
    provider: {
      provider: dto.provider.provider,
      isKeySet: dto.provider.key_set,
      keyLast4: dto.provider.key_last4,
      updatedAt: dto.provider.updated_at,
    },
    providers: dto.providers,
    models: dto.models.map((model) => ({
      id: model.id, modelId: model.model_id, label: model.label, isHidden: model.is_hidden, inUse: model.in_use,
    })),
    limits: { resumeTailor: dto.limits.resume_tailor, resumeParse: dto.limits.resume_parse },
    efforts: dto.efforts,
    useCases: dto.modules.map((module) => ({
      key: module.key,
      label: module.label,
      takesEffort: module.takes_effort,
      prompts: module.prompts,
      modelIds: module.model_ids,
      presets: module.presets.map((preset) => ({
        id: preset.id,
        module: preset.module,
        name: preset.name,
        notes: preset.notes,
        isActive: preset.is_active,
        archivedAt: preset.archived_at,
        current: {
          version: preset.current.version,
          modelId: preset.current.model_id,
          effort: preset.current.effort,
          prompts: preset.current.prompts,
          createdAt: preset.current.created_at,
        },
      })),
    })),
  };
}
