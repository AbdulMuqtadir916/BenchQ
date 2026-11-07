"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Bold, Italic, LoaderCircle, Sparkles, Underline } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { RewriteAction } from "@/lib/schemas/resume-document";
import { useRewrite } from "@/lib/hooks/use-agents";
import { cn } from "@/lib/cn";
import { POPOVER_TRANSITION } from "@/lib/motion";
import { useStudio } from "./studio-store";

const AI_ACTIONS: Array<{ action: RewriteAction; label: string; hint: string }> = [
  { action: "improve", label: "Improve wording", hint: "Stronger verbs, clearer outcome" },
  { action: "concise", label: "Make it concise", hint: "Cut filler words" },
  { action: "quantify", label: "Add measurable impact", hint: "Suggest a metric to confirm" },
  { action: "grammar", label: "Fix grammar", hint: "Spelling, casing, punctuation" },
];
const HIGHLIGHT = "bq-ai-pending";
type Anchor = { top: number; left: number };

/** Above the selection, or below it when there's no room at the top; kept inside the viewport. */
function place(rect: DOMRect): Anchor {
  return {
    top: rect.top > 120 ? rect.top - 46 : rect.bottom + 10,
    left: Math.min(Math.max(rect.left + rect.width / 2, 180), window.innerWidth - 180),
  };
}

/**
 * Floats over a text selection inside any rich field in `scopeRef`: bold,
 * italic, underline and AI rewrite. ⌘J opens the AI menu from the keyboard.
 * Rewrites are simulated (mock adapter).
 */
export function SelectionToolbar({ scopeRef }: { scopeRef: RefObject<HTMLElement | null> }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [isMenuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState<RewriteAction | null>(null);
  const [formats, setFormats] = useState({ bold: false, italic: false, underline: false });
  const rewriteMutation = useRewrite();
  const range = useRef<Range | null>(null);
  const field = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion() ?? false;
  const { flash, notify } = useStudio.getState();

  const track = useCallback(() => {
    if (busy) return;
    const sel = window.getSelection();
    const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    const node = r?.commonAncestorContainer;
    const el = node ? (node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement) : null;
    const host = el?.closest<HTMLElement>("[data-rich-field]");
    if (!r || r.collapsed || !host || !scopeRef.current?.contains(host)) {
      if (!menuRef.current?.contains(document.activeElement)) {
        setAnchor(null);
        setMenuOpen(false);
      }
      return;
    }
    range.current = r.cloneRange();
    field.current = host;
    setAnchor(place(r.getBoundingClientRect()));
    setFormats({ bold: document.queryCommandState("bold"), italic: document.queryCommandState("italic"), underline: document.queryCommandState("underline") });
  }, [busy, scopeRef]);

  useEffect(() => {
    document.addEventListener("selectionchange", track);
    return () => document.removeEventListener("selectionchange", track);
  }, [track]);

  // Follow the selection through scrolling, zoom and layout shifts while the toolbar is up.
  const isShown = anchor !== null;
  useEffect(() => {
    if (!isShown) return;
    let frame = requestAnimationFrame(function follow() {
      const rect = range.current?.getBoundingClientRect();
      if (rect && rect.height > 0) {
        const next = place(rect);
        setAnchor((a) => (a && Math.abs(a.top - next.top) < 0.5 && Math.abs(a.left - next.left) < 0.5 ? a : next));
      }
      frame = requestAnimationFrame(follow);
    });
    return () => cancelAnimationFrame(frame);
  }, [isShown]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j" && anchor) {
        e.preventDefault();
        setMenuOpen(true);
        requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus());
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anchor]);

  function restoreSelection() {
    const sel = window.getSelection();
    if (!range.current || !field.current || !sel) return false;
    field.current.focus({ preventScroll: true });
    sel.removeAllRanges();
    sel.addRange(range.current);
    return true;
  }

  function format(command: "bold" | "italic" | "underline") {
    document.execCommand(command);
    setFormats((f) => ({ ...f, [command]: document.queryCommandState(command) }));
  }

  async function rewrite(action: RewriteAction) {
    const target = field.current;
    const r = range.current;
    if (!target || !r) return;
    setBusy(action);
    setMenuOpen(false);
    if ("highlights" in CSS) CSS.highlights.set(HIGHLIGHT, new Highlight(r));
    try {
      const result = await rewriteMutation.mutateAsync({ text: r.toString(), action });
      if (restoreSelection()) document.execCommand("insertText", false, result.text);
      const fieldId = target.dataset.fieldId;
      if (fieldId) flash(fieldId);
      notify("AI rewrite applied. Read it over before you send.", "ai");
    } catch (error) {
      notify(error instanceof Error ? error.message : "AI rewrite is unavailable. Edit the text manually.", "danger");
    } finally {
      if ("highlights" in CSS) CSS.highlights.delete(HIGHLIGHT);
      setBusy(null);
      setAnchor(null);
    }
  }

  if (typeof document === "undefined") return null;

  const btn = "inline-flex h-7 min-w-7 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-1.5 text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] aria-pressed:bg-[var(--color-primary-subtle)] aria-pressed:text-[var(--color-primary-subtle-fg)]";

  return createPortal(
    <AnimatePresence>
      {anchor ? (
        <motion.div
          key="selection-toolbar"
          role="toolbar"
          aria-label="Text formatting"
          initial={reduce ? false : { opacity: 0, y: 4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
          transition={POPOVER_TRANSITION}
          onMouseDown={(e) => e.preventDefault()}
          style={{ top: anchor.top, left: anchor.left }}
          className="fixed z-[70] -translate-x-1/2 rounded-[var(--radius-lg)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-lg)]"
        >
          {busy ? (
            <span role="status" className="flex h-7 items-center gap-2 px-2 text-sm text-[var(--color-violet-fg)]">
              <LoaderCircle size={14} className="animate-spin" aria-hidden />
              {AI_ACTIONS.find((a) => a.action === busy)?.label}…
            </span>
          ) : (
            <div className="flex items-center gap-0.5">
              <button type="button" className={btn} aria-pressed={formats.bold} aria-label="Bold" title="Bold  ⌘B" onClick={() => format("bold")}><Bold size={14} aria-hidden /></button>
              <button type="button" className={btn} aria-pressed={formats.italic} aria-label="Italic" title="Italic  ⌘I" onClick={() => format("italic")}><Italic size={14} aria-hidden /></button>
              <button type="button" className={btn} aria-pressed={formats.underline} aria-label="Underline" title="Underline  ⌘U" onClick={() => format("underline")}><Underline size={14} aria-hidden /></button>
              <span className="mx-1 h-4 w-px bg-[var(--color-border)]" aria-hidden />
              <button type="button" className={cn(btn, "font-[550] text-[var(--color-violet-fg)]")} aria-haspopup="menu" aria-expanded={isMenuOpen} title="Rewrite with AI  ⌘J" onClick={() => setMenuOpen((o) => !o)}>
                <Sparkles size={14} aria-hidden />
                <span className="text-sm">Ask AI</span>
              </button>
            </div>
          )}
          {isMenuOpen && !busy ? (
            <div
              ref={menuRef}
              role="menu"
              aria-label="Rewrite with AI"
              className="absolute left-1/2 top-full mt-1.5 w-60 -translate-x-1/2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-lg)]"
              onKeyDown={(e) => {
                const items = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
                const i = items.indexOf(document.activeElement as HTMLElement);
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
                }
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setMenuOpen(false);
                  restoreSelection();
                }
              }}
            >
              {AI_ACTIONS.map((a) => (
                <button key={a.action} type="button" role="menuitem" onClick={() => void rewrite(a.action)} className="flex w-full flex-col items-start rounded-[var(--radius-md)] px-2.5 py-1.5 text-left hover:bg-[var(--color-surface-2)] focus-visible:bg-[var(--color-surface-2)]">
                  <span className="text-sm font-[550] text-[var(--color-text)]">{a.label}</span>
                  <span className="text-caption text-[var(--color-text-3)]">{a.hint}</span>
                </button>
              ))}
              <p className="mt-1 border-t border-[var(--color-border)] px-2.5 pb-1 pt-1.5 text-caption text-[var(--color-text-3)]">Read AI edits over before you send.</p>
            </div>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
