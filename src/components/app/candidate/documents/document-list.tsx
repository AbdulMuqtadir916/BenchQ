"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, FileImage, FileText, Link2, Trash2 } from "lucide-react";
import type { CandidateDocument, DocumentKind } from "@/lib/schemas/document";
import { formatRelative } from "@/lib/format/timezone";
import { EASE_OUT } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { KIND_META, KIND_ORDER, expiryStatus, formatSize } from "./document-meta";

interface DocumentListProps {
  documents: CandidateDocument[];
  now: number;
  canAct: boolean;
  onRemove: (id: string) => void;
}

/** Documents grouped by type, visa first. Each row: expiry, what it backs, copy link, remove. */
export function DocumentList({ documents, now, canAct, onRemove }: DocumentListProps) {
  const groups = KIND_ORDER.map((kind) => ({ kind, items: documents.filter((d) => d.kind === kind) })).filter((g) => g.items.length);
  return (
    <div className="space-y-4">
      {groups.map(({ kind, items }) => (
        <DocumentGroup key={kind} kind={kind} items={items} now={now} canAct={canAct} onRemove={onRemove} />
      ))}
    </div>
  );
}

function DocumentGroup({ kind, items, now, canAct, onRemove }: { kind: DocumentKind; items: CandidateDocument[] } & Omit<DocumentListProps, "documents">) {
  const reduce = useReducedMotion() ?? false;
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const { label, Icon } = KIND_META[kind];

  async function copy(doc: CandidateDocument) {
    await navigator.clipboard.writeText(doc.shareUrl);
    setCopiedId(doc.id);
    setTimeout(() => setCopiedId((id) => (id === doc.id ? null : id)), 1600);
  }

  return (
    <section className="bq-card overflow-hidden p-0" aria-label={label}>
      <h3 className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2 text-label text-[var(--color-text-2)]">
        <Icon size={14} aria-hidden className="text-[var(--color-text-3)]" />{label}<span className="tabular text-[var(--color-text-3)]">{items.length}</span>
      </h3>
      <ul className="divide-y divide-[var(--color-border)]">
        <AnimatePresence initial={false}>
          {items.map((doc) => {
            const expiry = expiryStatus(doc, now);
            const FileIcon = doc.mimeType.startsWith("image/") ? FileImage : FileText;
            return (
              <motion.li key={doc.id} layout={!reduce} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: reduce ? 0 : 20 }} transition={{ duration: 0.22, ease: EASE_OUT }} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
                <span aria-hidden className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-3)]"><FileIcon size={16} /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-strong text-[var(--color-text)]">{doc.title}</p>
                  <p className="truncate text-sm text-[var(--color-text-3)]">{doc.fileName} · {formatSize(doc.sizeKb)} · added {formatRelative(doc.uploadedAt)}</p>
                  {expiry ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {expiry ? <Tag tone={expiry.tone}>{expiry.label}</Tag> : null}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {confirmId === doc.id ? (
                    <>
                      <span className="text-sm text-[var(--color-text-2)]">Remove?</span>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>Keep</Button>
                      <Button size="sm" variant="danger" onClick={() => { setConfirmId(null); onRemove(doc.id); }}>Remove</Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => void copy(doc)} aria-label={`Copy share link for ${doc.title}`}>
                        {copiedId === doc.id ? <Check size={13} aria-hidden /> : <Link2 size={13} aria-hidden />}
                        {copiedId === doc.id ? "Copied" : "Copy link"}
                      </Button>
                      {canAct ? (
                        <button type="button" onClick={() => setConfirmId(doc.id)} aria-label={`Remove ${doc.title}`} className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-3)] hover:bg-[var(--color-danger-bg)] hover:text-[var(--color-danger-fg)]"><Trash2 size={14} aria-hidden /></button>
                      ) : null}
                    </>
                  )}
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </section>
  );
}
