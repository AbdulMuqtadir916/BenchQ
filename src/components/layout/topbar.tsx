"use client";

import { Search } from "lucide-react";
import { ShiftClock } from "./shift-clock";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { PrincipalSwitcher } from "@/components/dev/principal-switcher";
import { useCommandPalette } from "@/components/command/command-palette";
import { NotificationsMenu } from "@/components/layout/notifications-menu";

export function Topbar() {
  const { open } = useCommandPalette();
  return (
    <header className="bq-topbar">
      <div className="min-w-0"><PrincipalSwitcher align="start" /></div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="hidden xl:block"><ShiftClock /></div>
        <button type="button" onClick={open} aria-label="Open command palette" className="bq-secondary inline-flex h-8 items-center gap-2 rounded-[var(--radius-md)] px-2.5 text-sm">
          <Search size={14} aria-hidden />
          <span className="hidden sm:inline">Search</span>
          <kbd className="hidden sm:inline text-mono-sm text-[var(--color-text-3)] ml-3">⌘ K</kbd>
        </button>
        <NotificationsMenu />
        <ThemeToggle />
      </div>
    </header>
  );
}
