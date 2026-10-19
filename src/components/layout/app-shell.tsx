"use client";

import { useEffect } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { useUiStore } from "@/lib/stores/ui-store";
import { useGlobalShortcuts } from "@/lib/hooks/use-keyboard-shortcuts";
import { CommandPalette } from "@/components/command/command-palette";
import { KeyboardHintSheet } from "@/components/command/keyboard-hint-sheet";
import { RouteGuard } from "@/components/routes/route-guard";
import { DemoStorageNotice } from "@/components/app/demo-storage-notice";
import { ToastViewport } from "@/components/app/toast-viewport";

/**
 * AppShell — Sidebar + Topbar + main. Docs/04 §1.1. `variant="admin"` is the platform tier's shell
 * (docs/07 P2): the same frosted frame with the admin nav.
 * Sidebar collapse persists in localStorage via useUiStore.
 * Global keyboard system + command palette wired here so they're active
 * on every (app) route.
 */
export function AppShell({ children, modal, variant = "firm" }: { children: React.ReactNode; modal?: React.ReactNode; variant?: "firm" | "admin" }) {
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const hydrate = useUiStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const area = variant === "admin" ? "platform" : "firm";
  useGlobalShortcuts(area);

  return (
    <div className="bq-shell">
      <a href="#main-content" className="sr-only focus:not-sr-only">Skip to content</a>
      <div className="bq-frame">
      <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} variant={variant} />
      <div className="bq-workspace">
        <Topbar variant={variant} />
        <main id="main-content" className="min-w-0">
          {/* Never lose a change silently: shown while the demo data can't be saved (docs/03 §3.3). */}
          <div className="bq-page pb-0 empty:hidden"><DemoStorageNotice /></div>
          <RouteGuard>{children}</RouteGuard>
        </main>
      </div>
      </div>
      <CommandPalette area={area} />
      <KeyboardHintSheet area={area} />
      <ToastViewport />
      {modal}
    </div>
  );
}
