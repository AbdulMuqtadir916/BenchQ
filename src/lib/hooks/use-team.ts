"use client";

import { useQuery } from "@tanstack/react-query";
import { teamApi } from "@/lib/api/team";
import { queryKeys } from "@/lib/query/keys";
import { useFirmId } from "@/lib/tenancy/firm-context";

export function useTeam() {
  const firmId = useFirmId();
  return useQuery({
    queryKey: queryKeys.team.list(firmId),
    queryFn: () => teamApi.list(firmId),
  });
}
