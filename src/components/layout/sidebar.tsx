"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import { activeNavId, navFor, type RouteDef } from "@/lib/routes/registry";
import { useHref } from "@/lib/routes/use-href";
import { EASE_OUT } from "@/lib/motion";

/**
 * Frosted navigation: 208px expanded, 60px collapsed, 48px mobile rail.
 * Items come from the route registry: a route the principal can't open isn't rendered. The admin
 * variant (docs/07 P2) shows the platform nav instead of the firm's workspace and preferences.
 */

type NavGroup = { label: string; section: NonNullable<RouteDef["nav"]>["section"] };
const GROUPS: Record<"firm" | "admin", NavGroup[]> = {
  firm: [{ label: "Workspace", section: "workspace" }, { label: "Preferences", section: "preferences" }],
  admin: [{ label: "Platform", section: "admin" }],
};

export function Sidebar({
  collapsed,
  onToggle,
  variant = "firm",
}: {
  collapsed: boolean;
  onToggle: () => void;
  variant?: "firm" | "admin";
}) {
  const principal = useSignedInPrincipal();
  const reduceMotion = useReducedMotion() ?? false;
  const pathname = usePathname() ?? "";
  const groups = GROUPS[variant].map((group) => ({ ...group, routes: navFor(principal, group.section) }));
  const activeId = activeNavId(groups.flatMap((group) => group.routes), pathname);
  const fade = { duration: reduceMotion ? 0 : 0.14, ease: EASE_OUT };

  // Width, padding and label opacity transition in CSS (.bq-sidebar in globals.css), so the
  // workspace reflows smoothly beside it and nothing is scaled. Icons keep their x position.
  return (
    <aside className="bq-sidebar" data-collapsed={collapsed} aria-label="Primary">
      {/* Same height in both states (48px row + 20px gap) so the nav never shifts vertically. */}
      <div className="relative h-[4.25rem]">
        <AnimatePresence initial={false} mode="popLayout">
          {collapsed ? (
            <motion.div
              key="collapsed"
              className="flex flex-col items-center gap-1 pt-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { ...fade, delay: reduceMotion ? 0 : 0.1 } }}
              exit={{ opacity: 0, transition: fade }}
            >
              <Image src="/logo-mark.png" alt="BenchQ" width={28} height={28} priority className="sidebar-mark rounded-[var(--radius-md)]" />
              <button
                type="button"
                onClick={onToggle}
                aria-label="Expand sidebar"
                aria-expanded={false}
                title="Expand sidebar"
                className="sidebar-toggle inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-3)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
              >
                <PanelLeftOpen size={15} aria-hidden />
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="expanded"
              className="flex h-12 w-full items-center pl-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { ...fade, delay: reduceMotion ? 0 : 0.12 } }}
              exit={{ opacity: 0, transition: fade }}
            >
              <Image src="/logo-full.svg" alt="BenchQ" width={489} height={100} priority className="sidebar-wordmark logo-wordmark h-auto w-[100px]" />
              <button
                type="button"
                onClick={onToggle}
                aria-label="Collapse sidebar"
                aria-expanded
                title="Collapse sidebar"
                className="sidebar-toggle ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-3)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
              >
                <PanelLeftClose size={15} aria-hidden />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden">
        {groups.map((group, index) => (
          <div key={group.section} className={index > 0 ? "mt-5" : undefined}>
            <p className="sidebar-label mb-2 px-2.5 text-caption text-[var(--color-text-3)]" aria-hidden={collapsed}>{group.label}</p>
            <ul className="space-y-0.5">
              {group.routes.map((route) => (
                <SidebarItem key={route.id} route={route} isActive={route.id === activeId} />
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}

function SidebarItem({ route, isActive }: { route: RouteDef; isActive: boolean }) {
  const toHref = useHref();
  const Icon = route.nav?.icon;

  return (
    <li>
      <Link
        href={toHref(route)}
        aria-current={isActive ? "page" : undefined}
        title={route.title}
        aria-label={route.title}
        className="bq-nav-item text-body"
      >
        {Icon ? <Icon size={16} aria-hidden="true" className="shrink-0" /> : null}
        <span className="sidebar-label flex-1 truncate">{route.title}</span>
      </Link>
    </li>
  );
}
