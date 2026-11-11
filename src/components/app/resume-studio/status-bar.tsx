"use client";

import { AlertTriangle, Info, Sparkles } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ResumeDocument } from "@/lib/schemas/resume-document";
import { allText } from "@/lib/resume-doc/ops";
import { stripTags } from "@/lib/resume-doc/rich-text";
import { cn } from "@/lib/cn";
import { POPOVER_TRANSITION } from "@/lib/motion";
import { useStudio } from "./studio-store";

const NOTICE_ICON = { info: Info, ai: Sparkles, danger: AlertTriangle } as const;

/** Bottom bar: live counts and notices. */
export function StatusBar({ doc }: { doc: ResumeDocument }) {
  const notice = useStudio((s) => s.notice);
  const reduce = useReducedMotion() ?? false;

  const words = allText(doc).reduce((n, t) => n + stripTags(t.text.html).split(" ").filter(Boolean).length, 0);
  const NoticeIcon = notice ? NOTICE_ICON[notice.tone] : Info;

  return (
    <footer className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-1.5">
      <span className="tabular hidden text-sm text-[var(--color-text-3)] md:inline">
        {words} words
      </span>

      <div className="ml-auto min-w-0" aria-live="polite">
        <AnimatePresence>
          {notice ? (
            <motion.span
              key={notice.text}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={POPOVER_TRANSITION}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[var(--radius-full)] px-2.5 py-1 text-sm",
                notice.tone === "ai" && "bg-[var(--color-violet-bg)] text-[var(--color-violet-fg)]",
                notice.tone === "danger" && "bg-[var(--color-danger-bg)] text-[var(--color-danger-fg)]",
                notice.tone === "info" && "bg-[var(--color-info-bg)] text-[var(--color-info-fg)]",
              )}
            >
              <NoticeIcon size={13} aria-hidden />
              <span className="truncate">{notice.text}</span>
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>
    </footer>
  );
}
