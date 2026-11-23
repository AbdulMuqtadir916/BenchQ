"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCan } from "@/lib/auth/permissions";
import { workHoursLabel, workHoursProblem } from "@/lib/derive/work-hours";
import { useUpdateWorkHours } from "@/lib/hooks/use-team";
import { useShowToast } from "@/lib/stores/toast-store";
import type { Firm } from "@/lib/schemas/session";
import { SettingRow } from "./setting-row";
import { ErrorNote } from "@/components/app/error-note";
import { describeError } from "@/lib/api/error-text";

/**
 * The firm's work hours (07 Q67, decided 2026-11-17, Q152–Q174): a work day runs from one start to the next, the
 * candidate's Days and the daily job-search limits follow it. The OWNER changes them (`firm.editHours`); everyone
 * else, and a support view, reads them. A change never moves work already done to another Day.
 */
export function WorkHoursCard({ firm }: { firm: Pick<Firm, "workStart" | "workEnd" | "primaryTimezone"> }) {
  const canEdit = useCan("firm.editHours");
  const [isEditing, setIsEditing] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>Work hours</CardTitle>
        {canEdit && !isEditing ? <Button variant="secondary" size="sm" onClick={() => setIsEditing(true)}>Change</Button> : null}
      </CardHeader>
      {isEditing ? (
        <WorkHoursForm firm={firm} onDone={() => setIsEditing(false)} />
      ) : (
        <dl className="space-y-3 text-sm">
          <SettingRow label="Hours" value={`${workHoursLabel(firm.workStart, firm.workEnd)} (${firm.primaryTimezone})`} />
        </dl>
      )}
      <p className="mt-3 text-caption text-[var(--color-text-3)]">
        A work day runs from one start to the next. A candidate&apos;s Days and the daily job-search limits follow it.
      </p>
    </Card>
  );
}

function WorkHoursForm({ firm, onDone }: { firm: Pick<Firm, "workStart" | "workEnd">; onDone: () => void }) {
  const update = useUpdateWorkHours();
  const showToast = useShowToast();
  const [start, setStart] = useState(firm.workStart);
  const [end, setEnd] = useState(firm.workEnd);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const problem = workHoursProblem(start, end);
  const shown = isSubmitted ? problem ?? (update.error ? describeError(update.error) : null) : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    setIsSubmitted(true);
    if (problem || update.isPending) return;
    update.mutate({ workStart: start, workEnd: end }, {
      onSuccess: () => {
        showToast(`Work hours set to ${workHoursLabel(start, end)}.`);
        onDone();
      },
    });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3" onKeyDown={(event) => { if (event.key === "Escape") onDone(); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm">
          <span className="text-label text-[var(--color-text-2)]">Start</span>
          <Input type="time" required autoFocus value={start} onChange={(event) => setStart(event.target.value)}
            aria-invalid={shown ? true : undefined} aria-describedby={shown ? "work-hours-error" : undefined} />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="text-label text-[var(--color-text-2)]">End (may be past midnight)</span>
          <Input type="time" required value={end} onChange={(event) => setEnd(event.target.value)}
            aria-invalid={shown ? true : undefined} aria-describedby={shown ? "work-hours-error" : undefined} />
        </label>
      </div>
      <ErrorNote id="work-hours-error" text={shown} className="text-caption" />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onDone} disabled={update.isPending}>Cancel</Button>
        <Button type="submit" size="sm" disabled={update.isPending}>{update.isPending ? "Saving…" : "Save"}</Button>
      </div>
    </form>
  );
}
