"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

export interface SearchableOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  options: SearchableOption[];
  onValueChange: (value: string) => void;
  "aria-label": string;
  searchPlaceholder: string;
  className?: string;
}

/** A dropdown you can type into: click it, type part of a name, and pick from what's left. */
export function SearchableSelect({ value, options, onValueChange, searchPlaceholder, className, "aria-label": ariaLabel }: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? options.filter((option) => option.label.toLowerCase().includes(needle)) : options;
  }, [options, query]);

  useEffect(() => {
    if (!isOpen) return;
    function dismiss(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false);
    }
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [isOpen]);

  function open() {
    setQuery("");
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
    setIsOpen(true);
  }

  function close() {
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  function pick(option: SearchableOption | undefined) {
    if (!option) return;
    onValueChange(option.value);
    close();
  }

  function onSearchKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => (shown.length ? (index + step + shown.length) % shown.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(shown[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();          // closes this list, and doesn't also go back a level on the page
      close();
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => (isOpen ? setIsOpen(false) : open())}
        className="bq-input inline-flex h-8 w-full items-center justify-between gap-2 text-sm"
      >
        <span className="min-w-0 truncate">{selected?.label}</span>
        <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-[var(--color-text-3)]" />
      </button>
      {isOpen ? (
        <div className="absolute right-0 z-40 mt-1.5 w-64 max-w-[calc(100vw-2rem)] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-md)]">
          <div className="relative mb-1">
            <Search size={14} aria-hidden="true" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-3)]" />
            <Input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls={listboxId}
              aria-activedescendant={shown[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
              aria-label={searchPlaceholder}
              value={query}
              placeholder={searchPlaceholder}
              onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
              onKeyDown={onSearchKey}
              className="h-8 pl-8"
            />
          </div>
          <ul id={listboxId} role="listbox" aria-label={ariaLabel} className="max-h-64 overflow-y-auto">
            {shown.map((option, index) => {
              const isSelected = option.value === value;
              return (
                <li
                  key={option.value}
                  id={`${listboxId}-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => pick(option)}
                  className={cn(
                    "flex min-h-8 cursor-pointer items-center gap-2 rounded-[var(--radius-md)] px-2 text-sm text-[var(--color-text-2)]",
                    index === activeIndex && "bg-[var(--color-bg-subtle)] text-[var(--color-text)]",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {isSelected ? <Check size={13} aria-hidden="true" className="shrink-0" /> : null}
                </li>
              );
            })}
            {shown.length === 0 ? <li role="presentation" className="px-2 py-2 text-sm text-[var(--color-text-3)]">No matches</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
