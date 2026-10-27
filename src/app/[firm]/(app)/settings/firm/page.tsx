"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SettingRow } from "@/components/app/settings/setting-row";
import { errorMessage } from "@/features/admin/admin-dialog";
import { useCan } from "@/lib/auth/permissions";
import { useUpdateFirmSettings } from "@/lib/hooks/use-team";
import { useFirm } from "@/lib/tenancy/firm-context";

export default function FirmSettingsPage() {
  const firm = useFirm();
  const canEdit = useCan("firmSettings.edit");

  return (
    <Card>
      <CardHeader><CardTitle>Firm</CardTitle></CardHeader>
      <dl className="space-y-3 text-sm">
        <SettingRow label="Firm name" value={firm.name} />
        <SettingRow label="Primary timezone" value={firm.primaryTimezone} />
        <SettingRow label="Client timezone" value={firm.clientTimezone} />
        <SettingRow label="Shift window" value="18:30 – 00:30 IST" />
        <SettingRow label="Default follow-up cadence" value="Day-3 LinkedIn · Day-7 email" />
        {canEdit ? null : <SettingRow label="BDE capacity" value={`${firm.bdeCapacity} candidates per BDE`} />}
      </dl>
      {canEdit ? <BdeCapacityForm current={firm.bdeCapacity} /> : null}
    </Card>
  );
}

/**
 * The OWNER's BDE capacity (07 Q46): how many working candidates a BDE can take on comfortably. Assigning past it
 * shows a warning, never a block.
 */
function BdeCapacityForm({ current }: { current: number }) {
  const update = useUpdateFirmSettings();
  const [value, setValue] = useState(String(current));
  const capacity = Number(value);
  const problem = Number.isInteger(capacity) && capacity >= 1 && capacity <= 50 ? null : "A whole number from 1 to 50.";
  const isChanged = !problem && capacity !== current;

  function save(event: FormEvent) {
    event.preventDefault();
    if (isChanged) update.mutate({ bdeCapacity: capacity });
  }

  return (
    <form onSubmit={save} className="mt-4 space-y-2 border-t border-[var(--color-border)] pt-4" noValidate>
      <label htmlFor="bde-capacity" className="text-label text-[var(--color-text-2)]">BDE capacity</label>
      <div className="flex flex-wrap items-center gap-2">
        <Input id="bde-capacity" inputMode="numeric" className="w-24" value={value} onChange={(event) => setValue(event.target.value.replace(/[^\d]/g, ""))}
          aria-invalid={problem ? true : undefined} aria-describedby="bde-capacity-help" />
        <span className="text-sm text-[var(--color-text-2)]">candidates per BDE</span>
        <Button type="submit" size="sm" variant="secondary" disabled={!isChanged || update.isPending}>{update.isPending ? "Saving…" : "Save"}</Button>
        {update.isSuccess && !isChanged ? <span role="status" className="text-caption text-[var(--color-success-fg)]">Saved.</span> : null}
      </div>
      <p id="bde-capacity-help" className={problem ? "text-caption text-[var(--color-danger-fg)]" : "text-caption text-[var(--color-text-3)]"}>
        {problem ?? "Candidates a BDE can work comfortably. A warning when assigning, never a block."}
      </p>
      {update.isError ? <p role="alert" className="text-sm text-[var(--color-danger-fg)]">{errorMessage(update.error)}</p> : null}
    </form>
  );
}
