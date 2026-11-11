"use client";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PlanUsageCard } from "@/components/app/settings/plan-usage-card";
import { SettingRow } from "@/components/app/settings/setting-row";
import { useFirm } from "@/lib/tenancy/firm-context";

/**
 * Read-only (07 Q59, Q60): the firm's name and timezones are changed by a Super Admin, and the plan's limits (BDE
 * seats, candidates) are the only caps. There is no per-BDE capacity to set.
 */
export default function FirmSettingsPage() {
  const firm = useFirm();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Firm</CardTitle></CardHeader>
        <dl className="space-y-3 text-sm">
          <SettingRow label="Firm name" value={firm.name} />
          <SettingRow label="Primary timezone" value={firm.primaryTimezone} />
          <SettingRow label="Client timezone" value={firm.clientTimezone} />
        </dl>
        <p className="mt-3 text-caption text-[var(--color-text-3)]">Ask BenchQ to change the firm name or timezones.</p>
      </Card>
      <PlanUsageCard />
    </div>
  );
}
