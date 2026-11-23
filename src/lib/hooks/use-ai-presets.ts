"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aiPresetsApi, type PresetEdit, type PresetInput, type TestSample } from "@/lib/api/ai-presets";
import { queryKeys } from "@/lib/query/keys";
import type { AiSetup } from "@/lib/schemas/ai-presets";

const key = queryKeys.platform.aiSetup;

/** /admin/ai-presets. Every write answers with the whole setup, which replaces the cache; the audit log refreshes too. */
function useSetupMutation<Input>(write: (input: Input) => Promise<AiSetup>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: (setup) => {
      client.setQueryData(key(), setup);
      void client.invalidateQueries({ queryKey: queryKeys.platform.audit() });
    },
  });
}

export const useAiSetup = () => useQuery({ queryKey: key(), queryFn: aiPresetsApi.get });
export const useAvailableAiModels = (isEnabled: boolean) => useQuery({
  queryKey: queryKeys.platform.aiAvailableModels(),
  queryFn: aiPresetsApi.availableModels,
  enabled: isEnabled,
  staleTime: 3_600_000,
});
export const useSaveAiProvider = () => useSetupMutation(aiPresetsApi.saveProvider);
export const useAddAiModel = () => useSetupMutation(aiPresetsApi.addModel);
export const useHideAiModel = () => useSetupMutation(aiPresetsApi.hideModel);
export const useCreateAiPreset = () => useSetupMutation((input: PresetInput) => aiPresetsApi.createPreset(input));
export const useEditAiPreset = (id: string) => useSetupMutation((input: PresetEdit) => aiPresetsApi.editPreset(id, input));
export const useActivateAiPreset = () => useSetupMutation(({ id, force }: { id: string; force?: boolean }) => aiPresetsApi.activate(id, force));
export const useArchiveAiPreset = () => useSetupMutation((id: string) => aiPresetsApi.archive(id));
export const useRestoreAiPreset = () => useSetupMutation((id: string) => aiPresetsApi.restore(id));
export const useSaveAiLimits = () => useSetupMutation(aiPresetsApi.saveLimits);
export const useAiTestRun = (id: string) => useMutation({ mutationFn: (sample: TestSample) => aiPresetsApi.testRun(id, sample) });
