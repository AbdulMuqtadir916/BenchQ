"use client";

import { useState, useRef, useEffect, useId } from "react";
import { BriefcaseBusiness, ChevronDown, Crown, Eye, ShieldUser, UsersRound, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useSession } from "@/lib/stores/session-store";
import type { FirmRole } from "@/lib/schemas/enums";
import { ROLES } from "@/lib/routes/registry";
import { cn } from "@/lib/cn";
import { CONTENT_EXIT, POPOVER_TRANSITION } from "@/lib/motion";

/**
 * RoleSwitcher — dev-only, behind NEXT_PUBLIC_SHOW_ROLE_SWITCHER.
 * docs/01 §7: use it constantly to verify that role-dependent surfaces
 * render correctly.
 */

const ROLE_DETAILS: Record<FirmRole, { label: string; description: string }> = {
  OWNER: { label: "Owner", description: "Business overview" },
  MANAGER: { label: "Manager", description: "Team performance" },
  BDE: { label: "BDE", description: "Personal work queue" },
  VIEWER: { label: "Viewer", description: "Read-only access" },
};

const ROLE_ICONS: Record<FirmRole, LucideIcon> = {
  OWNER: Crown,
  MANAGER: UsersRound,
  BDE: BriefcaseBusiness,
  VIEWER: Eye,
};

export function RoleSwitcher({ align = "end" }: { align?: "start" | "end" }) {
  const show = process.env.NEXT_PUBLIC_SHOW_ROLE_SWITCHER !== "false";
  const role = useSession((s) => s.user.role);
  const setRole = useSession((s) => s.setRole);
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion() ?? false;
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!show) return null;

  function closeOnEscape(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      ref.current?.querySelector<HTMLButtonElement>("[aria-haspopup='menu']")?.focus();
    }
  }

  return (
    <div ref={ref} className="relative" onKeyDown={closeOnEscape}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Switch workspace role"
        className={cn(
          "bq-secondary inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[var(--radius-md)]",
          "text-sm transition-[background,box-shadow] duration-[var(--duration-instant)]",
        )}
      >
        <ShieldUser size={14} aria-hidden="true" />
        <span className="font-[550]">{ROLE_DETAILS[role].label}</span>
        <ChevronDown size={14} aria-hidden="true" className={cn("transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
      {open ? (
        <motion.ul
          id={menuId}
          role="menu"
          aria-label="Switch workspace role"
          initial={{ opacity: 0, y: reduceMotion ? 0 : -4, scale: reduceMotion ? 1 : 0.985, filter: reduceMotion ? "none" : "blur(3px)" }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: reduceMotion ? 0 : -2, scale: reduceMotion ? 1 : 0.99, filter: reduceMotion ? "none" : "blur(2px)", transition: CONTENT_EXIT }}
          transition={POPOVER_TRANSITION}
          style={{ transformOrigin: align === "start" ? "top left" : "top right" }}
          className={cn(
            "absolute mt-2 min-w-[204px] p-1.5 z-40",
            align === "start" ? "left-0" : "right-0",
            "rounded-[var(--radius-lg)] border border-[var(--color-border)]",
            "bg-[var(--color-surface)] shadow-[var(--shadow-md)]",
          )}
        >
          {ROLES.map((r) => {
            const RoleIcon = ROLE_ICONS[r];
            const isSelected = r === role;

            return <li key={r}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                onClick={() => {
                  setRole(r);
                  setOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2 text-left px-2.5 py-2 rounded-[var(--radius-md)] text-sm",
                  isSelected
                    ? "bg-[var(--color-primary-subtle)] text-[var(--color-primary-subtle-fg)] font-[600]"
                    : "text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
                )}
              >
                <span className={cn(
                  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)]",
                  isSelected ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-text-3)]",
                )}>
                  <RoleIcon size={14} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block leading-4">{ROLE_DETAILS[r].label}</span>
                  <span className="block mt-0.5 text-caption font-normal text-[var(--color-text-3)]">{ROLE_DETAILS[r].description}</span>
                </span>
              </button>
            </li>
          })}
        </motion.ul>
      ) : null}
      </AnimatePresence>
    </div>
  );
}
