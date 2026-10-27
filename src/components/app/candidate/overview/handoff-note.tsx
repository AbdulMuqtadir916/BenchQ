"use client";

import { MessageSquareQuote } from "lucide-react";
import { Card } from "@/components/ui/card";
import { latestHandoff } from "@/lib/derive/assignment";
import { formatRelative } from "@/lib/format/timezone";
import { useLedger } from "@/lib/hooks/use-ledger";

/** How far back the overview looks for the note: the ledger has no per-candidate filter yet (module 07). */
const LEDGER_WINDOW = 500;

/**
 * The latest handoff note (docs/candidate-onboarding/05 §6): "Note from {actor}, {when}", from the candidate's latest
 * ASSIGN entry. An annotation, not a list: nothing shows while the ledger loads, if it fails, or when the last move had
 * no note. ASSIGN entries come from the backend's candidates, so on mock candidates this stays hidden until module 07.
 */
export function HandoffNote({ candidateId }: { candidateId: string }) {
  const ledger = useLedger({ limit: LEDGER_WINDOW });
  const entry = ledger.data ? latestHandoff(candidateId, ledger.data) : null;
  if (!entry) return null;
  return (
    <Card>
      <p className="flex items-center gap-1.5 text-label text-[var(--color-text-3)]">
        <MessageSquareQuote size={13} aria-hidden />Note from {entry.actorName}, {formatRelative(entry.createdAt)}
      </p>
      <p className="mt-2 whitespace-pre-line text-body text-[var(--color-text)]">{entry.note}</p>
    </Card>
  );
}
