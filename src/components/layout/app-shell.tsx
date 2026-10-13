"use client";

import { useEffect } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { useUiStore } from "@/lib/stores/ui-store";
import { useGlobalShortcuts } from "@/lib/hooks/use-keyboard-shortcuts";
import { CommandPalette } from "@/components/command/command-palette";
import { KeyboardHintSheet } from "@/components/command/keyboard-hint-sheet";
import { RouteGuard } from "@/components/routes/route-guard";

/**
 * AppShell — Sidebar + Topbar + main. Docs/04 §1.1.
 * Sidebar collapse persists in localStorage via useUiStore.
 * Global keyboard system + command palette wired here so they're active
 * on every (app) route.
 */
export function AppShell({ children, modal }: { children: React.ReactNode, modal?: React.ReactNode }) {
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const hydrate = useUiStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useGlobalShortcuts();

  return (
    <div className="bq-shell">
      <a href="#main-content" className="sr-only focus:not-sr-only">Skip to content</a>
      <div className="bq-frame">
      <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      <div className="bq-workspace">
        <Topbar />
        <main id="main-content" className="min-w-0"><RouteGuard>{children}</RouteGuard></main>
      </div>
      </div>
      <CommandPalette />
      <KeyboardHintSheet />
      {modal}
    </div>
  );
}
