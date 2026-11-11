"use client";

import { Check, Circle, LoaderCircle, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type AgentRunStatus = "idle" | "running" | "complete" | "fallback";

interface AgentRunPanelProps {
  title: string;
  stages: readonly string[];
  activeStage: number;
  status: AgentRunStatus;
  elapsedMs?: number;
  fallbackMessage?: string;
  onCancel?: () => void;
  className?: string;
}

export function AgentRunPanel({
  title,
  stages,
  activeStage,
  status,
  elapsedMs = 0,
  fallbackMessage = "The agent stopped. Continue with the manual editor.",
  onCancel,
  className,
}: AgentRunPanelProps) {
  const isFallback = status === "fallback";
  const isComplete = status === "complete";

  return (
    <section
      aria-live={isFallback ? "assertive" : "polite"}
      aria-busy={status === "running"}
      className={cn(
        "rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-h3 text-[var(--color-text)]">{title}</h3>
          <p className="mt-1 text-caption text-[var(--color-text-3)]">
            Read generated content over before you send it.
          </p>
        </div>
        {status === "running" ? (
          <span className="text-mono-sm tabular text-[var(--color-text-3)]">
            {(elapsedMs / 1_000).toFixed(1)}s
          </span>
        ) : null}
      </div>

      {isFallback ? (
        <div className="mt-4 flex gap-3 rounded-[var(--radius-md)] bg-[var(--color-warning-bg)] p-3 text-[var(--color-warning-fg)]">
          <TriangleAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-sm">{fallbackMessage}</p>
        </div>
      ) : (
        <ol className="mt-4 space-y-2">
          {stages.map((stage, index) => {
            const hasFinished = isComplete || index < activeStage;
            const isActive = status === "running" && index === activeStage;
            const Icon = hasFinished ? Check : isActive ? LoaderCircle : Circle;

            return (
              <li
                key={stage}
                className={cn(
                  "flex min-h-8 items-center gap-3 rounded-[var(--radius-sm)] px-2 text-sm",
                  isActive && "bg-[var(--color-primary-subtle)] text-[var(--color-primary-subtle-fg)]",
                  hasFinished && "text-[var(--color-text)]",
                  !hasFinished && !isActive && "text-[var(--color-text-3)]",
                )}
              >
                <Icon
                  size={16}
                  aria-hidden="true"
                  className={cn(isActive && "animate-spin")}
                />
                <span>{stage}</span>
              </li>
            );
          })}
        </ol>
      )}

      {status === "running" && elapsedMs >= 8_000 && onCancel ? (
        <div className="mt-4 border-t border-[var(--color-border)] pt-3">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel and edit manually
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export type { AgentRunPanelProps, AgentRunStatus };
