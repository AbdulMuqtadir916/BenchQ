"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CloudUpload, LoaderCircle, X } from "lucide-react";
import type { DocumentKind } from "@/lib/schemas/document";
import { useUploadDocument } from "@/lib/hooks/use-documents";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ErrorNote } from "@/components/app/error-note";
import { describeError } from "@/lib/api/error-text";
import { KIND_META, KIND_ORDER, detectKind, formatSize, titleFromFile } from "./document-meta";

interface Pending { fileName: string; mimeType: string; sizeKb: number; kind: DocumentKind; title: string; expires: string }

/** Drop or browse a file, confirm its type (pre-detected) and expiry, save. */
export function UploadDocument({ candidateId, onSaved }: { candidateId: string; onSaved: (title: string) => void }) {
  const reduce = useReducedMotion() ?? false;
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setDragging] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const upload = useUploadDocument(candidateId);

  function pick(file: File | undefined) {
    if (!file) return;
    upload.reset();
    setPending({ fileName: file.name, mimeType: file.type || "application/octet-stream", sizeKb: Math.max(1, Math.round(file.size / 1024)), kind: detectKind(file.name), title: titleFromFile(file.name), expires: "" });
  }

  function save() {
    if (!pending) return;
    const { expires, ...rest } = pending;
    upload.mutate(
      { ...rest, expiresAt: expires && KIND_META[pending.kind].hasExpiry ? new Date(`${expires}T12:00:00Z`).toISOString() : null },
      { onSuccess: (doc) => { setPending(null); onSaved(doc.title); } },
    );
  }

  return (
    <div>
      <input ref={inputRef} type="file" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      <AnimatePresence mode="wait" initial={false}>
        {pending ? (
          <motion.div key="form" initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE_OUT }} className="rounded-[var(--radius-lg)] border border-[var(--color-primary)] bg-[var(--color-primary-subtle)] p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-sm text-[var(--color-text-2)]"><span className="font-[550] text-[var(--color-text)]">{pending.fileName}</span> · {formatSize(pending.sizeKb)}</p>
              <button type="button" onClick={() => setPending(null)} aria-label="Cancel upload" className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-3)] hover:bg-[var(--color-surface)]"><X size={14} aria-hidden /></button>
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_12rem_10rem]">
              <Input aria-label="Document title" value={pending.title} onChange={(e) => setPending({ ...pending, title: e.target.value })} />
              <Select aria-label="Document type" value={pending.kind} onValueChange={(v) => setPending({ ...pending, kind: v as DocumentKind })} options={KIND_ORDER.map((k) => ({ value: k, label: KIND_META[k].label }))} />
              {KIND_META[pending.kind].hasExpiry ? <Input type="date" aria-label="Expiry date" value={pending.expires} onChange={(e) => setPending({ ...pending, expires: e.target.value })} /> : <span className="hidden sm:block" />}
            </div>
            {upload.error ? <ErrorNote text={describeError(upload.error)} className="mt-2" /> : null}
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={upload.isPending || !pending.title.trim()}>
                {upload.isPending ? <LoaderCircle size={13} className="animate-spin" aria-hidden /> : null}
                {upload.isPending ? "Uploading…" : "Save document"}
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.button
            key="drop"
            type="button"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files[0]); }}
            className={cn("flex w-full items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-dashed px-4 py-5 text-sm transition-colors", isDragging ? "border-[var(--color-primary)] bg-[var(--color-primary-subtle)] text-[var(--color-primary-subtle-fg)]" : "border-[var(--color-border-strong)] text-[var(--color-text-3)] hover:border-[var(--color-primary)] hover:text-[var(--color-text)]")}
          >
            <CloudUpload size={18} aria-hidden />
            <span><span className="font-[550] text-[var(--color-text)]">Drop a file</span> or browse — visa copy, ID, certificates, letters</span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
