"use client";

import { useMemo } from "react";
import { PageHeader } from "@/components/app/page-header";
import { useAudit, usePlatformFirms } from "@/lib/hooks/use-platform";
import { useNow } from "@/lib/hooks/use-now";
import { queryGroup } from "@/lib/query/query-group";
import { useUrlState } from "@/lib/routes/use-url-state";
import { AuditTable, auditQuery, filterAudit } from "./audit-table";

const QUERY = auditQuery("7d");

/** /admin/audit (docs/04 §14.7): every ledger entry, platform and firm (A13). Default: the last 7 days. */
export function AuditPage() {
  const now = useNow();
  const audit = useAudit();
  const firms = usePlatformFirms();
  const group = queryGroup(audit, firms);
  const [query, setQuery] = useUrlState(QUERY);
  const entries = useMemo(() => (audit.data ? filterAudit(audit.data, query, now) : []), [audit.data, query, now]);
  return (
    <div className="bq-page">
      <PageHeader title="Audit" subtitle="Everything that happened on the platform and in every firm. Read-only." />
      <AuditTable
        entries={entries}
        query={query}
        setQuery={setQuery}
        firms={firms.data ?? []}
        defaultRange="7d"
        isLoading={group.status === "pending"}
        error={group.status === "error" ? group.error : null}
        onRetry={group.retry}
      />
    </div>
  );
}
