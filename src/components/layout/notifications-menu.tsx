"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Bell, BriefcaseBusiness, KeyRound, MessageSquareText, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { CountBadge } from "@/components/ui/count-badge";
import { CONTENT_EXIT, POPOVER_TRANSITION } from "@/lib/motion";
import { isPendingRequest, useMarkNotificationRead, useNotifications } from "@/lib/hooks/use-notifications";
import type { RouteId, RouteQuery } from "@/lib/routes/registry";
import { useHref } from "@/lib/routes/use-href";

type Notification = {
  id: string;
  title: string;
  detail: string;
  time: string;
  route: RouteId;
  query?: RouteQuery;
  icon: LucideIcon;
  tone: "blue" | "green" | "amber";
  /** A backend request: its read state is the server's. Absent for the demo items. */
  isRequestUnread?: boolean;
};

function relativeTime(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

const NOTIFICATIONS: Notification[] = [
  {
    id: "new-job-match",
    title: "New 98% job match",
    detail: "Senior Java Developer at Brillio LLC.",
    time: "12m",
    route: "jobs",
    icon: BriefcaseBusiness,
    tone: "green",
  },
  {
    id: "candidate-response",
    title: "Candidate response received",
    detail: "Rajesh replied to your latest outreach.",
    time: "38m",
    route: "outreach",
    icon: MessageSquareText,
    tone: "blue",
  },
];

const TONE_CLASS: Record<Notification["tone"], string> = {
  blue: "bg-[var(--color-primary-subtle)] text-[var(--color-primary)]",
  green: "bg-[var(--color-success-bg)] text-[var(--color-success-fg)]",
  amber: "bg-[var(--color-warning-bg)] text-[var(--color-warning-fg)]",
};

/**
 * The bell. Password-reset requests waiting for this person's decision come from the backend (07 Q54) and open the
 * Requests inbox; the firm's other updates are still demo data. The admin variant shows only the requests.
 */
export function NotificationsMenu({ variant = "firm" }: { variant?: "firm" | "admin" }) {
  const toHref = useHref();
  const [open, setOpen] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const markRequestRead = useMarkNotificationRead();
  const inboxRoute: RouteId = variant === "admin" ? "admin.notifications" : "notifications";
  const requestsRoute: RouteId = variant === "admin" ? "admin.notifications.requests" : "notifications.requests";
  const requests: Notification[] = (useNotifications().data ?? []).filter(isPendingRequest).map((item) => ({
    id: item.id,
    title: item.title,
    detail: item.detail,
    time: relativeTime(item.createdAt),
    route: requestsRoute,
    icon: KeyRound,
    tone: "amber",
    isRequestUnread: item.readAt === null,
  }));
  const notifications = [...requests, ...(variant === "firm" ? NOTIFICATIONS : [])];
  const reduceMotion = useReducedMotion() ?? false;
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const isUnread = (n: Notification) => (n.isRequestUnread ?? true) && !readIds.has(n.id);
  const unreadCount = notifications.filter(isUnread).length;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setOpen(false);
    buttonRef.current?.focus();
  }

  function markRead(notification: Notification) {
    setReadIds(current => new Set(current).add(notification.id));
    if (notification.isRequestUnread) markRequestRead.mutate(notification.id);
  }

  function markAllRead() {
    setReadIds(new Set(notifications.map(({ id }) => id)));
    for (const request of requests) if (request.isRequestUnread) markRequestRead.mutate(request.id);
  }

  return (
    <div ref={ref} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Notifications"
        onClick={() => setOpen(current => !current)}
        className="bq-secondary relative inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-2)] hover:text-[var(--color-text)]"
      >
        <Bell size={15} aria-hidden />
        <CountBadge count={unreadCount} className="absolute -right-1 -top-1" />
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={menuId}
            role="menu"
            aria-label="Notifications"
            initial={{ opacity: 0, y: reduceMotion ? 0 : -4, scale: reduceMotion ? 1 : 0.985, filter: reduceMotion ? "none" : "blur(3px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: reduceMotion ? 0 : -2, scale: reduceMotion ? 1 : 0.99, filter: reduceMotion ? "none" : "blur(2px)", transition: CONTENT_EXIT }}
            transition={POPOVER_TRANSITION}
            className="absolute right-0 z-50 mt-2 w-[340px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-md)] origin-top-right"
          >
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3.5 py-3">
              <div>
                <div className="text-body-strong text-[var(--color-text)]">Notifications</div>
                <div className="mt-0.5 text-caption text-[var(--color-text-3)]">{unreadCount ? `${unreadCount} unread updates` : "You're all caught up"}</div>
              </div>
              {unreadCount ? (
                <button type="button" onClick={markAllRead} className="rounded-[var(--radius-sm)] px-2 py-1 text-caption font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary-subtle)]">
                  Mark all read
                </button>
              ) : null}
            </div>

            <div className="p-1.5">
              {notifications.length === 0 ? <p className="px-2.5 py-6 text-center text-caption text-[var(--color-text-3)]">Nothing waiting for you.</p> : null}
              {notifications.map(notification => {
                const Icon = notification.icon;
                const unread = isUnread(notification);
                return (
                  <Link
                    key={notification.id}
                    href={toHref(notification.route, {}, notification.query)}
                    role="menuitem"
                    onClick={() => { markRead(notification); setOpen(false); }}
                    className={cn(
                      "flex items-start gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2.5 transition-colors hover:bg-[var(--color-surface-2)]",
                      unread && "bg-[var(--color-primary-subtle)]/45",
                    )}
                  >
                    <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)]", TONE_CLASS[notification.tone])}>
                      <Icon size={14} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start gap-2">
                        <span className={cn("min-w-0 flex-1 text-sm leading-4 text-[var(--color-text)]", unread && "font-semibold")}>{notification.title}</span>
                        <span className="shrink-0 text-mono-sm text-[var(--color-text-3)]">{notification.time}</span>
                      </span>
                      <span className="mt-1 block text-caption leading-4 text-[var(--color-text-3)]">{notification.detail}</span>
                    </span>
                    {unread ? <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-primary)]" aria-label="Unread" /> : null}
                  </Link>
                );
              })}
            </div>

            <div className="border-t border-[var(--color-border)] p-2">
              <Link href={toHref(inboxRoute)} role="menuitem" onClick={() => setOpen(false)} className="flex h-8 items-center justify-center rounded-[var(--radius-md)] text-sm font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary-subtle)]">
                View all notifications
              </Link>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
