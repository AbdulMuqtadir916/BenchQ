"use client";

import { useEffect } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { demoDataApi } from "@/lib/api/demo-data";
import { sessionApi } from "@/lib/api/session";
import { applySession } from "@/lib/hooks/use-session";

/** After the data changed underneath: refetch everything, and re-check who is signed in (a reset can remove an account). */
async function afterDataChange(queryClient: QueryClient): Promise<void> {
  applySession(await sessionApi.current().catch(() => null));
  await queryClient.invalidateQueries();
}

/** Mounted once in the query provider: another tab's change or a reset refreshes this tab. */
export function useDemoDataSync(queryClient: QueryClient) {
  useEffect(() => demoDataApi.watch(() => void afterDataChange(queryClient)), [queryClient]);
}

/** Sana's "Reset demo data" (docs/03 §3.3). */
export function useResetDemoData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => demoDataApi.reset(),
    onSuccess: () => afterDataChange(queryClient),
  });
}
