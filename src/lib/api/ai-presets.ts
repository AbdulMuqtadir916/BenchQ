import type { AiSetup } from "@/lib/schemas/ai-presets";
import { AiSetupDto, AvailableModelsDto, TestRunDto, toAiSetup } from "./dto/ai-presets";
import { http } from "./http";

const BASE = "/api/admin/ai";

export interface PresetInput {
  module: string;
  name: string;
  notes: string;
  modelId: string;
  effort: string;
  prompts: Record<string, string>;
}
export type PresetEdit = Omit<PresetInput, "module"> & { force?: boolean };
export interface TestSample {
  resume?: string;
  posting?: string;
  targetRole?: string;
  subject?: string;
  body?: string;
}

const setup = (dto: Parameters<typeof toAiSetup>[0]): AiSetup => toAiSetup(dto);

export const aiPresetsApi = {
  get: async () => setup(await http.get(BASE, AiSetupDto)),
  availableModels: () => http.get(`${BASE}/available-models`, AvailableModelsDto),
  saveProvider: async (input: { provider: string; apiKey?: string; force?: boolean }) =>
    setup(await http.put(`${BASE}/provider`, AiSetupDto, {
      body: { provider: input.provider, api_key: input.apiKey || null, force: input.force ?? false },
    })),
  addModel: async (modelId: string) => setup(await http.post(`${BASE}/models`, AiSetupDto, { body: { model_id: modelId } })),
  hideModel: async (id: string) => setup(await http.delete(`${BASE}/models/${encodeURIComponent(id)}`, AiSetupDto)),
  createPreset: async (input: PresetInput) => setup(await http.post(`${BASE}/presets`, AiSetupDto, {
    body: { module: input.module, name: input.name, notes: input.notes, model_id: input.modelId, effort: input.effort, prompts: input.prompts },
  })),
  editPreset: async (id: string, input: PresetEdit) => setup(await http.patch(`${BASE}/presets/${encodeURIComponent(id)}`, AiSetupDto, {
    body: { name: input.name, notes: input.notes, model_id: input.modelId, effort: input.effort, prompts: input.prompts, force: input.force ?? false },
  })),
  activate: async (id: string, force = false) => setup(await http.post(`${BASE}/presets/${encodeURIComponent(id)}/activate`, AiSetupDto, { body: { force } })),
  archive: async (id: string) => setup(await http.post(`${BASE}/presets/${encodeURIComponent(id)}/archive`, AiSetupDto)),
  restore: async (id: string) => setup(await http.post(`${BASE}/presets/${encodeURIComponent(id)}/restore`, AiSetupDto)),
  testRun: async (id: string, sample: TestSample) => (await http.post(`${BASE}/presets/${encodeURIComponent(id)}/test-run`, TestRunDto, {
    body: { resume: sample.resume, posting: sample.posting, target_role: sample.targetRole, subject: sample.subject, body: sample.body },
  })).output,
  saveLimits: async (limits: AiSetup["limits"]) => setup(await http.patch(`${BASE}/limits`, AiSetupDto, {
    body: { resume_tailor: limits.resumeTailor, resume_parse: limits.resumeParse },
  })),
};
