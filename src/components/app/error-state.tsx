"use client";

import { AlertTriangle, RefreshCw, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeError, systemErrorCode } from "@/lib/api/error-text";
import { cn } from "@/lib/cn";
import { ErrorReference } from "./error-reference";

/**
 * ErrorState — docs/05 §5. Every failed load renders this, never a blank screen. The words come from
 * `describeError` (src/lib/api/error-text.ts): the frontend's own for a system error (busy, throttled, offline,
 * unexpected, out of date), else the backend's. An unexpected error adds its reference with a copy button; an
 * out-of-date page offers Refresh instead of Retry. Never "Oops", never an exclamation mark (CLAUDE.md content rules).
 */
interface ErrorStateProps {
  error: Error;
  onRetry?: () => void;
  variant?: "inline" | "page";
  className?: string;
}

/** The heading when the error has no system title of its own. */
const LOAD_FAILED = "Something didn’t load";

export function ErrorState({
  error,
  onRetry,
  variant = "inline",
  className,
}: ErrorStateProps) {
  const text = describeError(error, { fallback: "The request failed. Try again." });
  const needsRefresh = systemErrorCode(error) === "SCHEMA_MISMATCH";
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center text-center px-6",
        variant === "page" ? "py-24" : "py-10",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)] mb-4 bg-[var(--color-danger-bg)] text-[var(--color-danger-fg)]"
      >
        <AlertTriangle size={22} />
      </span>
      <h3 className="text-h3 text-[var(--color-text)]">{text.title ?? LOAD_FAILED}</h3>
      <p className="mt-1.5 max-w-sm text-body text-[var(--color-text-3)]">{text.message}</p>
      {text.reference ? <ErrorReference reference={text.reference} className="mt-2 text-[var(--color-text-2)]" /> : null}
      {needsRefresh ? (
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => window.location.reload()}>
          <RefreshCw size={14} aria-hidden="true" />
          Refresh page
        </Button>
      ) : onRetry && text.canRetry ? (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          <RotateCw size={14} aria-hidden="true" />
          Retry
        </Button>
      ) : null}
    </div>
  );
}
