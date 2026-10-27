"use client";

import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { CandidateAvatar } from "@/components/app/candidate-avatar";
import { cn } from "@/lib/cn";

/**
 * One row of a step-5 radio group (docs/candidate-onboarding/05-assign.md §1): avatar, name, a line under it, and a
 * figure on the right. A native radio, so arrow keys and Space work; the whole row is its label. `isWarning` marks a
 * BDE at capacity (07 Q46) with an icon and words, still selectable.
 */
export function AssignOption({
  name,
  group,
  value,
  checked,
  disabled = false,
  title,
  detail,
  figure,
  isWarning = false,
  avatarKey,
  onChange,
}: {
  name: string;
  group: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  title: string;
  detail?: ReactNode;
  figure?: ReactNode;
  isWarning?: boolean;
  avatarKey?: string | null;
  onChange: () => void;
}) {
  return (
    <label className={cn("bq-choice w-full items-center gap-3 p-3", disabled && "cursor-not-allowed opacity-60")}>
      <input type="radio" name={group} value={value} checked={checked} disabled={disabled} onChange={onChange} className="h-3.5 w-3.5 shrink-0 accent-[var(--color-primary)]" />
      {avatarKey !== null ? <CandidateAvatar name={name} colorKey={avatarKey} size="sm" /> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-strong text-[var(--color-text)]">{title}</span>
        {detail ? <span className="block truncate text-caption text-[var(--color-text-3)]">{detail}</span> : null}
      </span>
      {figure ? (
        <span className={cn("flex shrink-0 items-center gap-1 text-caption tabular-nums", isWarning ? "text-[var(--color-warning-fg)]" : "text-[var(--color-text-2)]")}>
          {isWarning ? <AlertTriangle size={12} aria-hidden /> : null}
          {figure}
        </span>
      ) : null}
    </label>
  );
}

/** J/K move through a radio group like ↓/↑ (docs/04 §1.3), choosing the next enabled row. */
export function onRadioJK(event: React.KeyboardEvent<HTMLElement>) {
  const key = event.key.toLowerCase();
  if ((key !== "j" && key !== "k") || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target as HTMLElement;
  if (!(target instanceof HTMLInputElement) || target.type !== "radio") return;
  const radios = [...event.currentTarget.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${target.name}"]:not(:disabled)`)];
  const next = radios[radios.indexOf(target) + (key === "j" ? 1 : -1)];
  if (!next) return;
  event.preventDefault();
  next.focus();
  next.click();
}
