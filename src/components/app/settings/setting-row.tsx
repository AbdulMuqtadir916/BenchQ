export function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3 last:border-0 last:pb-0">
      <dt className="text-[var(--color-text-3)]">{label}</dt>
      <dd className="text-[var(--color-text-2)]">{value}</dd>
    </div>
  );
}
