"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Settings,
  Plus,
  Zap,
  Search,
  UserCircle,
  Building2,
  type LucideIcon,
} from "lucide-react";
import { useUiStore } from "@/lib/stores/ui-store";
import { useSignedInPrincipal } from "@/lib/stores/session-store";
import type { Principal } from "@/lib/schemas/tenancy";
import { canOpen, paletteRoutesFor, routeById, type RouteId } from "@/lib/routes/registry";
import { useHref } from "@/lib/routes/use-href";
import { usePaletteRecords } from "@/lib/hooks/use-palette-records";
import { cn } from "@/lib/cn";
import { CONTENT_EXIT, EASE_OUT, SPRING_PANEL } from "@/lib/motion";

/**
 * CommandPalette — docs/04 §1.2.
 * Wired to search real candidates and jobs.
 */

interface Command {
  id: string;
  label: string;
  group: "Actions" | "Navigation" | "Candidates" | "Jobs";
  icon: LucideIcon;
  keywords?: string;
  /** Registry id of the page this command opens; hidden from principals that can't open it. */
  routeId?: RouteId;
  run: (router: ReturnType<typeof useRouter>, toHref: ReturnType<typeof useHref>) => void;
}

const STATIC_COMMANDS: Command[] = [
  {
    id: "action-new-candidate",
    group: "Actions",
    label: "New candidate",
    icon: Plus,
    keywords: "add create",
    routeId: "candidates.new",
    run: (r, toHref) => r.push(toHref("candidates.new")),
  },
  {
    id: "action-capture-job",
    group: "Actions",
    label: "Capture job",
    icon: Plus,
    keywords: "add paste",
    routeId: "jobs.capture",
    run: (r, toHref) => r.push(toHref("jobs.capture")),
  },
  {
    id: "action-focus-mode",
    group: "Actions",
    label: "Start a run — focus mode",
    icon: Zap,
    keywords: "queue run",
    routeId: "focus",
    run: (r, toHref) => r.push(toHref("focus")),
  },
];

/** Actions the principal can open plus one Navigation entry per palette route in the registry. */
function staticCommandsFor(principal: Principal): Command[] {
  const actions = STATIC_COMMANDS.filter((command) => !command.routeId || canOpen(routeById(command.routeId), principal));
  const navigation = paletteRoutesFor(principal).map<Command>((route) => ({
    id: `nav-${route.id}`,
    group: "Navigation",
    label: route.id.startsWith("settings.") ? `Settings · ${route.title}` : route.title,
    icon: route.nav?.icon ?? Settings,
    run: (r, toHref) => r.push(toHref(route)),
  }));
  return [...actions, ...navigation];
}

export function useCommandPalette() {
  const open = useUiStore((s) => s.openCommandPalette);
  const close = useUiStore((s) => s.closeCommandPalette);
  return { open, close };
}

export function CommandPalette() {
  const router = useRouter();
  const toHref = useHref();
  const isOpen = useUiStore((s) => s.commandPaletteOpen);
  const close = useUiStore((s) => s.closeCommandPalette);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      queueMicrotask(() => {
        setQuery("");
        setActiveIndex(0);
        requestAnimationFrame(() => inputRef.current?.focus());
      });
    }
  }, [isOpen]);

  const records = usePaletteRecords();
  const reduceMotion = useReducedMotion() ?? false;
  const principal = useSignedInPrincipal();

  const results = useMemo(() => {
    const dynamicCommands: Command[] = [];
    
    records.candidates.forEach(c => {
      dynamicCommands.push({
        id: `candidate-${c.id}`,
        group: "Candidates",
        label: c.fullName,
        icon: UserCircle,
        keywords: c.primaryRole ?? "",
        run: (r, toHref) => r.push(toHref("candidates.detail", { id: c.id }))
      });
    });

    records.jobs.forEach(j => {
      dynamicCommands.push({
        id: `job-${j.id}`,
        group: "Jobs",
        label: j.title,
        icon: Building2,
        keywords: j.company.name,
        run: (r, toHref) => r.push(toHref("jobs.detail", { id: j.id }))
      });
    });

    const allCommands = [...staticCommandsFor(principal), ...dynamicCommands];
    
    const q = query.trim().toLowerCase();
    if (!q) return allCommands.slice(0, 50); // limit empty state
    return allCommands.filter((c) =>
      `${c.label} ${c.keywords ?? ""}`.toLowerCase().includes(q),
    ).slice(0, 50);
  }, [query, principal, records.candidates, records.jobs]);

  const grouped = useMemo(() => {
    const groups: Record<string, Command[]> = {};
    for (const c of results) {
      (groups[c.group] ??= []).push(c);
    }
    return groups;
  }, [results]);

  const safeActiveIndex = Math.min(activeIndex, Math.max(0, results.length - 1));

  function run(command: Command) {
    close();
    command.run(router, toHref);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = results[safeActiveIndex];
      if (cmd) run(cmd);
    }
  }

  return (
    <AnimatePresence initial={false}>
    {isOpen ? <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: CONTENT_EXIT }}
      transition={{ duration: 0.16, ease: EASE_OUT }}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
      onClick={close}
    >
      <div
        className="absolute inset-0 bg-[var(--color-overlay)]"
        aria-hidden="true"
      />
      <motion.div
        initial={{ opacity: 0, y: reduceMotion ? 0 : 8, scale: reduceMotion ? 1 : 0.985, filter: reduceMotion ? "none" : "blur(4px)" }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: reduceMotion ? 0 : -4, scale: reduceMotion ? 1 : 0.99, filter: reduceMotion ? "none" : "blur(2px)", transition: CONTENT_EXIT }}
        transition={reduceMotion ? { duration: 0.16, ease: EASE_OUT } : SPRING_PANEL}
        className={cn(
          "relative w-full max-w-xl overflow-hidden",
          "rounded-[var(--radius-xl)] border border-[var(--color-border)]",
          "bg-[var(--color-surface)] shadow-[var(--shadow-lg)]",
        )}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 px-4 h-12 border-b border-[var(--color-border)]">
          <Search size={16} className="text-[var(--color-text-3)]" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or jump to…"
            className="flex-1 bg-transparent outline-none text-body text-[var(--color-text)] placeholder:text-[var(--color-text-3)]"
            aria-label="Command palette input"
          />
          <kbd className="tabular text-caption text-[var(--color-text-3)]">Esc</kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto py-2">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-body text-[var(--color-text-3)]">
              No results
            </div>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <div key={group} className="mb-2">
                <div className="px-4 py-1 text-label text-[var(--color-text-3)]">
                  {group}
                </div>
                <ul>
                  {items.map((c) => {
                    const globalIndex = results.indexOf(c);
                    const active = globalIndex === safeActiveIndex;
                    const Icon = c.icon;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onMouseMove={() => setActiveIndex(globalIndex)}
                          onClick={() => run(c)}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 h-9 text-left text-body",
                            "transition-colors duration-[var(--duration-instant)]",
                            active
                              ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
                              : "text-[var(--color-text-2)]",
                          )}
                        >
                          <Icon size={16} aria-hidden="true" />
                          <span className="flex-1">{c.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </motion.div> : null}
    </AnimatePresence>
  );
}
