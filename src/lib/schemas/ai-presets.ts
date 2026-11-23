import { z } from "zod";

/** The Super Admin's AI setup (docs/02 §3.3, docs/integration/08-ai-presets.md). Platform data; the key is never sent. */
export const AiPresetVersionSchema = z.object({
  version: z.number().int().positive(),
  modelId: z.string(),
  effort: z.string(),
  prompts: z.record(z.string(), z.string()),
  createdAt: z.string(),
});
export type AiPresetVersion = z.infer<typeof AiPresetVersionSchema>;

export const AiPresetSchema = z.object({
  id: z.string(),
  module: z.string(),
  name: z.string(),
  notes: z.string(),
  isActive: z.boolean(),
  archivedAt: z.string().nullable(),
  current: AiPresetVersionSchema,
});
export type AiPreset = z.infer<typeof AiPresetSchema>;

export const AiPromptSpecSchema = z.object({
  name: z.string(),
  label: z.string(),
  placeholders: z.array(z.string()),
  optional: z.boolean(),
});
export type AiPromptSpec = z.infer<typeof AiPromptSpecSchema>;

export const AiUseCaseSchema = z.object({
  key: z.string(),
  label: z.string(),
  takesEffort: z.boolean(),
  prompts: z.array(AiPromptSpecSchema),
  modelIds: z.array(z.string()),
  presets: z.array(AiPresetSchema),
});
export type AiUseCase = z.infer<typeof AiUseCaseSchema>;

export const AiModelSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  label: z.string(),
  isHidden: z.boolean(),
  inUse: z.boolean(),
});
export type AiModel = z.infer<typeof AiModelSchema>;

export const AiSetupSchema = z.object({
  provider: z.object({
    provider: z.string(),
    isKeySet: z.boolean(),
    keyLast4: z.string().nullable(),
    updatedAt: z.string().nullable(),
  }),
  providers: z.array(z.object({ id: z.string(), label: z.string() })),
  models: z.array(AiModelSchema),
  limits: z.object({ resumeTailor: z.number().int().positive(), resumeParse: z.number().int().positive() }),
  efforts: z.array(z.string()),
  useCases: z.array(AiUseCaseSchema),
});
export type AiSetup = z.infer<typeof AiSetupSchema>;
