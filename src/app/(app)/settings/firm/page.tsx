"use client";

import { useSession } from "@/lib/stores/session-store";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingRow } from "@/components/app/settings/setting-row";

export default function FirmSettingsPage() {
  const firm = useSession((s) => s.firm);

  return (
    <Card>
      <CardHeader><CardTitle>Firm</CardTitle></CardHeader>
      <dl className="space-y-3 text-sm">
        <SettingRow label="Firm name" value={firm.name} />
        <SettingRow label="Primary timezone" value={firm.primaryTimezone} />
        <SettingRow label="Client timezone" value={firm.clientTimezone} />
        <SettingRow label="Shift window" value="18:30 – 00:30 IST" />
        <SettingRow label="Default follow-up cadence" value="Day-3 LinkedIn · Day-7 email" />
      </dl>
    </Card>
  );
}
