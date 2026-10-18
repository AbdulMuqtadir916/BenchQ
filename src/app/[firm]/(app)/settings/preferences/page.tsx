"use client";

import { useSignedInUser } from "@/lib/stores/session-store";
import { useUiStore } from "@/lib/stores/ui-store";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { SettingRow } from "@/components/app/settings/setting-row";

export default function PreferencesSettingsPage() {
  const user = useSignedInUser();

  return (
    <Card>
      <CardHeader><CardTitle>Preferences</CardTitle></CardHeader>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-[var(--color-text)]">Theme</div>
            <div className="text-caption text-[var(--color-text-3)]">Light is default; dark for the night shift.</div>
          </div>
          <ThemeToggle />
        </div>
        <DensityControl />
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-[var(--color-text)]">Keyboard shortcuts</div>
            <div className="text-caption text-[var(--color-text-3)]">Press <kbd className="text-mono-sm">?</kbd> anywhere to open the shortcut sheet.</div>
          </div>
          <Tag tone="neutral">⌘K · g d · g c · g j</Tag>
        </div>
        <dl>
          <SettingRow label="Signed in as" value={`${user.name} · ${user.role}`} />
        </dl>
      </div>
    </Card>
  );
}

function DensityControl() {
  const density = useUiStore((s) => s.density);
  const setDensity = useUiStore((s) => s.setDensity);
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-sm text-[var(--color-text)]">Density</div>
        <div className="text-caption text-[var(--color-text-3)]">Row height across tables.</div>
      </div>
      <div className="bq-tabs" role="tablist" aria-label="Density">
        {(["compact", "default", "comfortable"] as const).map((d) => (
          <button key={d} role="tab" aria-selected={density === d} onClick={() => setDensity(d)} className="capitalize">{d}</button>
        ))}
      </div>
    </div>
  );
}
