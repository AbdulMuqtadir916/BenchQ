"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { usePastePosting } from "@/lib/hooks/use-jobs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const MIN_LENGTH = 50;
const WORD = /[a-z0-9+#]+/g;

/** Whether the pasted text names the job's title or company (all of its words, any case or order): the backend's
 * own check, said before the round trip. */
export function mentionsJob(text: string, ...names: (string | null | undefined)[]): boolean {
  const words = new Set(text.toLowerCase().match(WORD) ?? []);
  return names.some((name) => {
    const own = name?.toLowerCase().match(WORD) ?? [];
    return own.length > 0 && own.every((word) => words.has(word));
  });
}

interface PastePostingDialogProps {
  candidateId: string;
  job: { id: string; title: string; company?: string | null };
  onClose: () => void;
  /** The posting is saved: the caller starts the tailoring again. */
  onSaved: () => void;
}

/**
 * A LinkedIn job comes without its posting, and BenchQ never fetches it (decided 2026-11-17, Q107, Q114): to tailor,
 * the BDE copies the posting from LinkedIn's page (shown in the job pane) and pastes it here. Refused when it names
 * neither the job's title nor its company.
 */
export function PastePostingDialog({ candidateId, job, onClose, onSaved }: PastePostingDialogProps) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const paste = usePastePosting();
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    field.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save() {
    const trimmed = text.trim();
    if (trimmed.length < MIN_LENGTH) return setProblem("Paste the whole posting: it's too short.");
    if (!mentionsJob(trimmed, job.title, job.company)) return setProblem("The text doesn't name this job's title or company. Copy the posting itself.");
    setProblem(null);
    paste.mutate({ candidateId, jobId: job.id, text: trimmed }, { onSuccess: onSaved });
  }

  const error = problem ?? (paste.error instanceof Error ? paste.error.message : null);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="paste-posting-title" className="fixed inset-0 z-50 flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-[var(--color-overlay)]" aria-hidden="true" />
      <form
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => { event.preventDefault(); save(); }}
        className={cn("relative w-full max-w-xl space-y-3 rounded-[var(--radius-xl)] border border-[var(--color-border)]",
          "bg-[var(--color-surface)] p-5 shadow-[var(--shadow-lg)]")}
      >
        <h2 id="paste-posting-title" className="text-h3 text-[var(--color-text)]">Paste the posting to tailor</h2>
        <p className="text-sm text-[var(--color-text-2)]">
          {job.title}{job.company ? ` at ${job.company}` : ""} came from LinkedIn without its text. Copy the job description from
          LinkedIn&apos;s page in the job pane, and paste it here.
        </p>
        <textarea ref={field} value={text} onChange={(event) => { setText(event.target.value); setProblem(null); }}
          aria-label="The job's posting" aria-invalid={Boolean(error)} aria-describedby={error ? "paste-posting-error" : undefined}
          rows={12} className="bq-input h-auto w-full py-2" placeholder="About the job…" />
        {error ? <p id="paste-posting-error" role="alert" className="text-sm text-[var(--color-danger-fg)]">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={paste.isPending}>
            {paste.isPending ? <LoaderCircle size={13} className="animate-spin" aria-hidden /> : null}Save and tailor
          </Button>
        </div>
      </form>
    </div>
  );
}
