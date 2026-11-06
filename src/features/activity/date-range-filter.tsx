"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isAfter, isSameMonth, parseISO, startOfMonth, startOfWeek, subDays, subMonths } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LedgerFilters } from "@/lib/api/analytics";
import { useLedgerDays } from "@/lib/hooks/use-ledger";
import { cn } from "@/lib/cn";

const DAY = "yyyy-MM-dd";
const WEEK_DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export interface DateRange {
  from?: string;
  to?: string;
}

const short = (day: string) => format(parseISO(day), "MMM d");

export function rangeLabel({ from, to }: DateRange): string {
  if (!from) return "All time";
  return !to || from === to ? short(from) : `${short(from)} – ${short(to)}`;
}

/** The quick ranges, counted from today in the firm's own time zone. */
export function presets(today: string): { label: string; range: DateRange }[] {
  const now = parseISO(today);
  const back = (days: number) => format(subDays(now, days), DAY);
  return [
    { label: "All time", range: {} },
    { label: "Today", range: { from: today, to: today } },
    { label: "Yesterday", range: { from: back(1), to: back(1) } },
    { label: "Last 7 days", range: { from: back(6), to: today } },
    { label: "Last 30 days", range: { from: back(29), to: today } },
    { label: "This month", range: { from: format(startOfMonth(now), DAY), to: today } },
  ];
}

interface DateRangeFilterProps extends DateRange {
  timeZone: string;
  onChange: (range: DateRange) => void;
  /** The view's other filters, so the calendar's dots mean this view's activity. */
  filters: LedgerFilters;
}

export function DateRangeFilter({ from, to, timeZone, onChange, filters }: DateRangeFilterProps) {
  const today = useMemo(() => formatInTimeZone(new Date(), timeZone, DAY), [timeZone]);
  const [isOpen, setIsOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(parseISO(from ?? today)));
  const [start, setStart] = useState<string | undefined>(from);
  const [end, setEnd] = useState<string | undefined>(to);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focusDay, setFocusDay] = useState(from ?? today);
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const shouldMoveFocus = useRef(false);

  const monthDays = useMemo(() => eachDayOfInterval({
    start: startOfWeek(month, { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  }), [month]);
  const daysQuery = useLedgerDays(
    { ...filters, fromDate: format(startOfMonth(month), DAY), toDate: format(endOfMonth(month), DAY) },
    { isEnabled: isOpen },
  );
  const activeDays = useMemo(() => new Set(daysQuery.data ?? []), [daysQuery.data]);

  useEffect(() => {
    if (!isOpen) return;
    function dismiss(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false);
    }
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [isOpen]);

  useEffect(() => {
    if (!shouldMoveFocus.current) return;
    shouldMoveFocus.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [focusDay, month]);

  function open() {
    setStart(from);
    setEnd(to);
    setHovered(null);
    setFocusDay(from ?? today);
    setMonth(startOfMonth(parseISO(from ?? today)));
    setIsOpen(true);
  }

  function close() {
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  function commit(range: DateRange) {
    onChange(range);
    close();
  }

  function pickDay(day: string) {
    setFocusDay(day);
    if (!start || end) {
      setStart(day);
      setEnd(undefined);
    } else if (day < start) {
      setEnd(start);
      setStart(day);
    } else {
      setEnd(day);
    }
  }

  function moveFocus(days: number) {
    const next = format(addDays(parseISO(focusDay), days), DAY);
    if (next > today) return;
    shouldMoveFocus.current = true;
    setFocusDay(next);
    if (!isSameMonth(parseISO(next), month)) setMonth(startOfMonth(parseISO(next)));
  }

  function onGridKey(event: React.KeyboardEvent) {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in moves) {
      event.preventDefault();
      moveFocus(moves[event.key]);
    }
  }

  const spanEnd = end ?? (start && hovered && hovered > start ? hovered : start);
  const isCurrentMonth = isSameMonth(month, parseISO(today));
  const quickRanges = presets(today);

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(event) => {
        if (isOpen && event.key === "Escape") {
          event.stopPropagation();        // closes the picker, and doesn't also go back a level on the page
          close();
        }
      }}
    >
      <div className="flex items-center gap-1">
        <button ref={triggerRef} type="button" aria-haspopup="dialog" aria-expanded={isOpen} aria-label={`Dates: ${rangeLabel({ from, to })}`} onClick={() => (isOpen ? setIsOpen(false) : open())} className="bq-input inline-flex h-8 w-auto items-center gap-2 text-sm">
          <CalendarDays size={14} aria-hidden="true" className="text-[var(--color-text-3)]" />
          <span className="whitespace-nowrap">{rangeLabel({ from, to })}</span>
          <ChevronDown size={14} aria-hidden="true" className="text-[var(--color-text-3)]" />
        </button>
        {from ? (
          <Button variant="ghost" size="sm" aria-label="Show all dates" onClick={() => onChange({})}>
            <X size={14} aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {isOpen ? (
        <div role="dialog" aria-label="Choose dates" className="absolute right-0 z-40 mt-1.5 flex w-max max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-md)] sm:flex-row">
          <ul className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)] p-2 sm:w-36 sm:flex-col sm:border-b-0 sm:border-r">
            {quickRanges.map(({ label, range }) => {
              const isActive = (range.from ?? "") === (from ?? "") && (range.to ?? "") === (to ?? "");
              return (
                <li key={label} className="shrink-0">
                  <button type="button" aria-pressed={isActive} onClick={() => commit(range)} className={cn("w-full whitespace-nowrap rounded-[var(--radius-md)] px-2 py-1.5 text-left text-sm text-[var(--color-text-2)] hover:bg-[var(--color-bg-subtle)]", isActive && "bg-[var(--color-primary-subtle)] text-[var(--color-primary-subtle-fg)]")}>
                    {label}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <Button variant="ghost" size="sm" aria-label="Previous month" onClick={() => setMonth((current) => subMonths(current, 1))}>
                <ChevronLeft size={16} aria-hidden="true" />
              </Button>
              <span className="text-sm font-medium text-[var(--color-text)]" aria-live="polite">{format(month, "MMMM yyyy")}</span>
              <Button variant="ghost" size="sm" aria-label="Next month" disabled={isCurrentMonth} onClick={() => setMonth((current) => addMonths(current, 1))}>
                <ChevronRight size={16} aria-hidden="true" />
              </Button>
            </div>
            <div ref={gridRef} role="grid" aria-label={format(month, "MMMM yyyy")} onKeyDown={onGridKey} className="grid grid-cols-7 gap-0.5">
              {WEEK_DAYS.map((name) => <span key={name} role="columnheader" className="py-1 text-center text-caption text-[var(--color-text-3)]">{name}</span>)}
              {monthDays.map((date) => {
                const day = format(date, DAY);
                const isFuture = isAfter(date, parseISO(today));
                const isEdge = day === start || day === spanEnd;
                const isInside = Boolean(start && spanEnd && day > start && day < spanEnd);
                return (
                  <button
                    key={day}
                    type="button"
                    data-day={day}
                    disabled={isFuture}
                    tabIndex={day === focusDay ? 0 : -1}
                    aria-label={`${format(date, "MMMM d")}${activeDays.has(day) ? ", has activity" : ""}`}
                    aria-pressed={isEdge}
                    onClick={() => pickDay(day)}
                    onMouseEnter={() => setHovered(day)}
                    className={cn(
                      "relative flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-sm text-[var(--color-text-2)] hover:bg-[var(--color-bg-subtle)] disabled:cursor-not-allowed disabled:text-[var(--color-text-disabled)] disabled:hover:bg-transparent",
                      !isSameMonth(date, month) && "text-[var(--color-text-3)]",
                      day === today && "underline underline-offset-4",
                      isInside && "bg-[var(--color-primary-subtle)]",
                      isEdge && "bg-[var(--color-primary)] text-[var(--color-primary-fg)] hover:bg-[var(--color-primary)]",
                    )}
                  >
                    {format(date, "d")}
                    {activeDays.has(day) ? <span aria-hidden="true" className={cn("absolute bottom-0.5 h-1 w-1 rounded-full bg-[var(--color-primary)]", isEdge && "bg-[var(--color-primary-fg)]")} /> : null}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3">
              <span className="text-caption text-[var(--color-text-3)]">{start ? (end ? `${short(start)} – ${short(end)}` : "Pick the end day, or Apply for one day") : "Pick a day, or a start and end day"}</span>
              <Button size="sm" disabled={!start} onClick={() => commit({ from: start, to: end ?? start })}>Apply</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
