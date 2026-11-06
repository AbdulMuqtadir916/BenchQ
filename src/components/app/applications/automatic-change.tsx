"use client";

import { useRef } from "react";
import { Bot, Mail, Undo2 } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import type { Application, ApplicationEvent } from "@/lib/schemas/application";
import { useUndoAutomaticChange } from "@/lib/hooks/use-applications";
import { newCommandId } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { STATUS_LABEL } from "./status-meta";

/** The application's latest change, when it was automatic and nothing has happened since (Undo is possible). */
export function latestAutomaticChange(application: Application): ApplicationEvent | null {
  const latest = [...application.events].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).at(-1);
  if (!latest || latest.source !== "email_classifier") return null;
  return latest.revision === null || latest.revision === application.statusRevision ? latest : null;
}

function undoFailure(error: Error): string {
  if (error instanceof ApiError && error.status === 409) return "A later decision exists, so this change can no longer be undone here. Reload and set the stage by hand if needed.";
  if (error instanceof ApiError && error.status === 403) return "You don't have permission to undo application changes.";
  return error.message;
}

/** "Moved automatically from an email" with the source email and a compensating Undo (DEBUG D-12). */
export function AutomaticChangeNotice({ application, canAct, onOpenEmail }: { application: Application; canAct: boolean; onOpenEmail?: (emailId: string) => void }) {
  const undo = useUndoAutomaticChange();
  const command = useRef<string | null>(null);
  const event = latestAutomaticChange(application);
  if (!event) return null;

  function run() {
    if (!event) return;
    command.current ??= newCommandId(); // the same click retried reuses its id: never two undos
    undo.mutate({ applicationId: application.id, eventId: event.id, expectedRevision: application.statusRevision, commandId: command.current });
  }

  return (
    <div className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-violet-bg)] p-3 text-sm text-[var(--color-violet-fg)]">
      <p className="flex items-start gap-1.5">
        <Bot size={15} aria-hidden className="mt-0.5 shrink-0" />
        <span>Moved automatically to <span className="font-[550]">{STATUS_LABEL[event.toStatus]}</span>{event.fromStatus ? <> from {STATUS_LABEL[event.fromStatus]}</> : null} because of a recruiter email.</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {event.emailId && onOpenEmail ? <Button size="sm" variant="secondary" onClick={() => onOpenEmail(event.emailId!)}><Mail size={13} aria-hidden /> Open email</Button> : null}
        {canAct ? <Button size="sm" variant="secondary" disabled={undo.isPending || undo.isSuccess} onClick={run}><Undo2 size={13} aria-hidden /> Undo</Button> : null}
      </div>
      {undo.isSuccess ? <p role="status">Undone. The application is back to its earlier stage.</p> : null}
      {undo.error ? <p role="alert" className="text-[var(--color-danger-fg)]">{undoFailure(undo.error)}</p> : null}
    </div>
  );
}
