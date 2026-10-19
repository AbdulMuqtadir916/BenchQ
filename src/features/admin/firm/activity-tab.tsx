"use client";

import { useMemo } from "react";
import { firmLedger } from "@/lib/derive/platform";
import { useNow } from "@/lib/hooks/use-now";
import { useUrlState } from "@/lib/routes/use-url-state";
import { AuditTable, auditQuery, filterAudit } from "../audit-table";
import { useFirmDetail } from "./use-firm-detail";

const QUERY = auditQuery("all");

/**
 * /admin/firms/[firmId]/activity (docs/04 §14.5): this firm's ledger, every action including support
 * views, newest first; filters (action, actor type, date range) in the URL. Read-only.
 */
export function FirmActivityTab() {
  const { detail } = useFirmDetail();
  const now = useNow();
  const [query, setQuery] = useUrlState(QUERY);
  const entries = useMemo(() => (detail ? filterAudit(firmLedger(detail.firm.id, detail.data.ledger), query, now) : []), [detail, query, now]);
  return <AuditTable entries={entries} query={query} setQuery={setQuery} defaultRange="all" isLoading={!detail} error={null} onRetry={() => undefined} />;
}
