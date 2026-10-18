"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { BriefcaseBusiness, ChevronDown, Crown, Eye, LogOut, ShieldCheck, ShieldUser, UsersRound, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useSignedInIdentity, useSignedInPrincipal } from "@/lib/stores/session-store";
import { useCurrentSession, useDevPrincipals, useDevSignInAs, useSignOut } from "@/lib/hooks/use-session";
import { landingHref } from "@/lib/routes/landing";
import { matchRoute } from "@/lib/routes/registry";
import type { Session } from "@/lib/schemas/session";
import type { DevPrincipalOption } from "@/lib/schemas/session";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/cn";
import { CONTENT_EXIT, POPOVER_TRANSITION } from "@/lib/motion";

/**
 * Dev principal switcher (docs/07 §3, T4): sign in as any fixture principal — every role in firm A,
 * the users of the other firms, and the platform admin (listed, not selectable until Phase P).
 * A switch that the current page still fits stays on it (a user of the firm in the URL); otherwise it
 * goes to the new principal's landing: another firm's user or a platform admin from a firm page
 * (staying would be a not-found, §2.5), a firm user from /admin (not-found for them, §2.3). Sign out
 * is at the end.
 * Rendered only when NEXT_PUBLIC_SHOW_DEV_TOOLS="true". Role simulation, not security.
 */

const ROLE_LABEL: Record<DevPrincipalOption["role"], string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  BDE: "BDE",
  VIEWER: "Viewer",
  PLATFORM_ADMIN: "Super Admin",
};
const ROLE_ICON: Record<DevPrincipalOption["role"], LucideIcon> = {
  OWNER: Crown,
  MANAGER: UsersRound,
  BDE: BriefcaseBusiness,
  VIEWER: Eye,
  PLATFORM_ADMIN: ShieldCheck,
};

/** Can the new session stay on the current page? Off the firm and admin areas (/dev) it always can. */
function pageFits(session: Session, area: string | null, urlSlug: string | null): boolean {
  if (area === "firm") return session.principal.kind === "firm" && session.firm?.slug === urlSlug;
  if (area === "platform") return session.principal.kind === "platform";
  return true;
}

/** Group label for an option: its firm, or the platform team. */
const groupOf = (option: DevPrincipalOption) => option.firmName ?? "BenchQ platform";

export function PrincipalSwitcher({ align = "end" }: { align?: "start" | "end" }) {
  const show = process.env.NEXT_PUBLIC_SHOW_DEV_TOOLS === "true";
  const urlSlug = useParams<{ firm?: string }>()?.firm ?? null;
  const area = matchRoute(usePathname() ?? "/")?.area ?? null;
  const principal = useSignedInPrincipal();
  const identity = useSignedInIdentity();
  // The signed-in user's own firm, which is not necessarily the URL's (e.g. on /dev); none for an admin.
  const firmName = useCurrentSession().data?.firm?.name ?? (principal.kind === "platform" ? "BenchQ platform" : "");
  const [open, setOpen] = useState(false);
  const principals = useDevPrincipals(show && open);
  const signInAs = useDevSignInAs({
    navigateTo: (session) => (pageFits(session, area, urlSlug) ? null : landingHref(session)),
  });
  const signOut = useSignOut();
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

  const options = principals.data ?? [];

  return (
    <div ref={ref} className="relative" onKeyDown={closeOnEscape}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Switch signed-in principal (dev)"
        className={cn(
          "bq-secondary inline-flex max-w-full items-center gap-1.5 h-8 px-2.5 rounded-[var(--radius-md)]",
          "text-sm transition-[background,box-shadow] duration-[var(--duration-instant)]",
        )}
      >
        <ShieldUser size={14} aria-hidden="true" className="shrink-0" />
        <span className="truncate font-[550]">{identity.name}</span>
        <span className="hidden truncate text-[var(--color-text-3)] sm:inline">· {identity.roleLabel}{firmName ? ` · ${firmName}` : ""}</span>
        <ChevronDown size={14} aria-hidden="true" className={cn("shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.ul
            id={menuId}
            role="menu"
            aria-label="Sign in as"
            aria-busy={principals.isLoading || signInAs.isPending || signOut.isPending}
            initial={{ opacity: 0, y: reduceMotion ? 0 : -4, scale: reduceMotion ? 1 : 0.985, filter: reduceMotion ? "none" : "blur(3px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : -2, scale: reduceMotion ? 1 : 0.99, filter: reduceMotion ? "none" : "blur(2px)", transition: CONTENT_EXIT }}
            transition={POPOVER_TRANSITION}
            style={{ transformOrigin: align === "start" ? "top left" : "top right" }}
            className={cn(
              "absolute mt-2 min-w-[17rem] max-h-[70vh] overflow-y-auto p-1.5 z-40",
              align === "start" ? "left-0" : "right-0",
              "rounded-[var(--radius-lg)] border border-[var(--color-border)]",
              "bg-[var(--color-surface)] shadow-[var(--shadow-md)]",
            )}
          >
            {principals.isLoading ? <li className="px-2.5 py-2 text-sm text-[var(--color-text-3)]">Loading principals…</li> : null}
            {principals.error ? <li className="px-2.5 py-2 text-sm text-[var(--color-danger-fg)]">Couldn&apos;t load principals.</li> : null}
            {options.map((option, index) => {
              const isGroupStart = index === 0 || groupOf(options[index - 1]!) !== groupOf(option);
              const isSelected = option.id === principal.userId;
              const Icon = ROLE_ICON[option.role];
              return (
                <Fragment key={option.id}>
                  {isGroupStart ? (
                    <li role="presentation" className="flex items-center justify-between gap-2 px-2.5 pt-2.5 pb-1 text-caption text-[var(--color-text-3)]">
                      <span className="truncate">{groupOf(option)}</span>
                      {option.firmStatus && option.firmStatus !== "ACTIVE" ? <Tag tone={option.firmStatus === "SUSPENDED" ? "red" : "amber"}>{option.firmStatus}</Tag> : null}
                    </li>
                  ) : null}
                  <li>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={isSelected}
                      aria-disabled={!option.available || undefined}
                      disabled={!option.available || signInAs.isPending}
                      title={option.note ?? undefined}
                      onClick={() => {
                        signInAs.mutate(option.id, { onSuccess: () => setOpen(false) });
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 text-left px-2.5 py-2 rounded-[var(--radius-md)] text-sm",
                        isSelected
                          ? "bg-[var(--color-primary-subtle)] text-[var(--color-primary-subtle-fg)] font-[600]"
                          : "text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
                        !option.available && "cursor-not-allowed opacity-60 hover:bg-transparent",
                      )}
                    >
                      <span className={cn(
                        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)]",
                        isSelected ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-text-3)]",
                      )}>
                        <Icon size={14} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate leading-4">{option.name}</span>
                        <span className="block mt-0.5 truncate text-caption font-normal text-[var(--color-text-3)]">
                          {ROLE_LABEL[option.role]}{option.note ? ` · ${option.note}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                </Fragment>
              );
            })}
            <li role="presentation" className="my-1 border-t border-[var(--color-border)]" />
            <li>
              <button
                type="button"
                role="menuitem"
                disabled={signOut.isPending || signInAs.isPending}
                onClick={() => signOut.mutate()}
                className="w-full flex items-center gap-2 text-left px-2.5 py-2 rounded-[var(--radius-md)] text-sm text-[var(--color-text-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
              >
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] text-[var(--color-text-3)]">
                  <LogOut size={14} aria-hidden="true" />
                </span>
                Sign out
              </button>
            </li>
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
