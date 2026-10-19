"use client";

import { useMemo } from "react";
import { useAudit, useCandidateUsage, usePlatformFirms, usePlatformInvites, usePlatformUsers } from "@/lib/hooks/use-platform";
import { queryGroup } from "@/lib/query/query-group";
import type { PlatformData } from "@/lib/derive/platform";

/**
 * The records the admin area derives its numbers from (docs/04 §14): every firm, user, invite,
 * candidate (firm + status) and ledger entry. One query group (docs/04 §13); `data` is only set once
 * every query loaded, so no number is ever built from missing data.
 */
export function usePlatformData() {
  const firms = usePlatformFirms();
  const users = usePlatformUsers();
  const invites = usePlatformInvites();
  const candidates = useCandidateUsage();
  const ledger = useAudit();
  const group = queryGroup(firms, users, invites, candidates, ledger);
  const data = useMemo<PlatformData | null>(
    () =>
      firms.data && users.data && invites.data && candidates.data && ledger.data
        ? { firms: firms.data, users: users.data, invites: invites.data, candidates: candidates.data, ledger: ledger.data }
        : null,
    [firms.data, users.data, invites.data, candidates.data, ledger.data],
  );
  return { group, data, queries: { firms, users, invites, candidates, ledger } };
}
