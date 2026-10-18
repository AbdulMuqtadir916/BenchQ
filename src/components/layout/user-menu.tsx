"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCurrentSession, useSignOut } from "@/lib/hooks/use-session";
import { useSignedInIdentity, useSignedInPrincipal } from "@/lib/stores/session-store";
import { cn } from "@/lib/cn";
import { CONTENT_EXIT, POPOVER_TRANSITION } from "@/lib/motion";

/**
 * Who is signed in, and Sign out (docs/07 L3). In the firm topbar, the admin shell and the full-page
 * gate screens (suspended, support required). Signing out here signs out every open tab (Q27). To act
 * as someone else, sign out and sign in as them: there is no principal switcher (Q25).
 */
export function UserMenu({ align = "end" }: { align?: "start" | "end" }) {
  const principal = useSignedInPrincipal();
  const identity = useSignedInIdentity();
  // The signed-in user's own firm (not necessarily the URL's, e.g. on /dev); the platform for an admin.
  const firmName = useCurrentSession().data?.firm?.name ?? (principal.kind === "platform" ? "BenchQ platform" : "");
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion() ?? false;
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }
  }

  return (
    <div ref={ref} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account: ${identity.name}`}
        className="bq-secondary inline-flex max-w-full items-center gap-1.5 h-8 px-2.5 rounded-[var(--radius-md)] text-sm transition-[background,box-shadow] duration-[var(--duration-instant)]"
      >
        <UserRound size={14} aria-hidden="true" className="shrink-0" />
        <span className="truncate font-[550]">{identity.name}</span>
        <span className="hidden truncate text-[var(--color-text-3)] sm:inline">· {identity.roleLabel}{firmName ? ` · ${firmName}` : ""}</span>
        <ChevronDown size={14} aria-hidden="true" className={cn("shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={menuId}
            role="menu"
            aria-label="Account"
            initial={{ opacity: 0, y: reduceMotion ? 0 : -4, scale: reduceMotion ? 1 : 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : -2, scale: reduceMotion ? 1 : 0.99, transition: CONTENT_EXIT }}
            transition={POPOVER_TRANSITION}
            style={{ transformOrigin: align === "start" ? "top left" : "top right" }}
            className={cn(
              "absolute mt-2 min-w-[15rem] p-1.5 z-40",
              align === "start" ? "left-0" : "right-0",
              "rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-md)]",
            )}
          >
            <div className="px-2.5 pt-2 pb-2.5">
              <p className="truncate text-sm font-[600] text-[var(--color-text)]">{identity.name}</p>
              <p className="mt-0.5 truncate text-caption text-[var(--color-text-3)]">{identity.roleLabel}{firmName ? ` · ${firmName}` : ""}</p>
            </div>
            <div role="separator" className="my-1 border-t border-[var(--color-border)]" />
            <button
              type="button"
              role="menuitem"
              disabled={signOut.isPending}
              onClick={() => signOut.mutate()}
              className="w-full flex items-center gap-2 text-left px-2.5 py-2 rounded-[var(--radius-md)] text-sm text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:opacity-60"
            >
              <LogOut size={14} aria-hidden="true" />
              {signOut.isPending ? "Signing out…" : "Sign out"}
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
