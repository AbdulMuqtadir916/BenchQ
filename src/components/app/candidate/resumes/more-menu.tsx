"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";

export type MoreItem =
  | { label: string; onSelect: () => void; tone?: "danger" }
  | { label: string; href: string };

const itemClass = "flex w-full items-center rounded-[var(--radius-md)] px-2.5 py-2 text-left text-sm text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:bg-[var(--color-surface-2)]";

/**
 * "⋯ More": a labelled menu (the one icon-only button on the card, with a tooltip). Arrow keys move, Home / End jump,
 * Esc closes and returns focus to the button.
 */
export function MoreMenu({ label, items }: { label: string; items: MoreItem[] }) {
  const [isOpen, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!isOpen) return;
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onDoc = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [isOpen]);

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!isOpen) return;
    const all = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = all.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => { e.preventDefault(); all[(i + all.length) % all.length]?.focus(); };
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(all.length - 1);
    else if (e.key === "Tab") setOpen(false);
  }

  if (!items.length) return null;
  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-label={label}
        title="More"
        onClick={() => setOpen((v) => !v)}
        className="bq-secondary inline-flex h-[var(--control-sm)] w-[var(--control-sm)] items-center justify-center rounded-[var(--radius-md)]"
      >
        <MoreHorizontal size={15} aria-hidden />
      </button>
      {isOpen ? (
        <div ref={menuRef} id={menuId} role="menu" aria-label={label}
          className="absolute right-0 z-30 mt-1.5 min-w-52 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-md)]">
          {items.map((item) =>
            "href" in item ? (
              <Link key={item.label} href={item.href} role="menuitem" tabIndex={-1} className={itemClass} onClick={() => close(false)}>{item.label}</Link>
            ) : (
              <button key={item.label} type="button" role="menuitem" tabIndex={-1}
                className={cn(itemClass, item.tone === "danger" && "text-[var(--color-danger-fg)] hover:text-[var(--color-danger-fg)]")}
                onClick={() => { close(false); item.onSelect(); }}>
                {item.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
