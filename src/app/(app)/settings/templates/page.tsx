import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Tag } from "@/components/ui/tag";

export default function TemplatesSettingsPage() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {["Modern", "Classic", "Minimal"].map((t) => (
        <Card key={t}>
          <CardHeader><CardTitle>{t} resume</CardTitle><Tag tone="blue">Resume</Tag></CardHeader>
          <div className="h-28 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)]" />
          <p className="mt-2 text-caption text-[var(--color-text-3)]">Merge fields: {"{name}"}, {"{title}"}, {"{summary}"}</p>
        </Card>
      ))}
      {["Intro", "Follow-up"].map((t) => (
        <Card key={t}>
          <CardHeader><CardTitle>{t} email</CardTitle><Tag tone="teal">Outreach</Tag></CardHeader>
          <p className="text-caption text-[var(--color-text-3)]">Merge fields: {"{First name}"}, {"{Company}"}, {"{Role}"}, {"{Candidate}"}</p>
        </Card>
      ))}
    </div>
  );
}
