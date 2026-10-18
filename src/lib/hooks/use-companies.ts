"use client";

import { useQuery } from "@tanstack/react-query";
import { companiesApi } from "@/lib/api/companies";
import { queryKeys } from "@/lib/query/keys";

/** Companies are global reference data (docs/07 Q13): not firm-scoped. */
export function useCompanies() {
  return useQuery({
    queryKey: queryKeys.companies.all(),
    queryFn: () => companiesApi.list(),
  });
}

export function useCompany(id: string) {
  return useQuery({
    queryKey: queryKeys.companies.detail(id),
    queryFn: () => companiesApi.byId(id),
    enabled: !!id,
  });
}
