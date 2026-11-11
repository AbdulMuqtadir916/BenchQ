"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Play, Square } from "lucide-react";
import { AgentRunPanel, TypewriterText } from "@/components/app/ai";
import { DataTable } from "@/components/app/data-table";
import { Button } from "@/components/ui/button";
import { useTailorResume } from "@/lib/hooks/use-agents";
import type { AgentRunStatus } from "@/components/app/ai";

interface DemoRow {
  id: string;
  candidate: string;
  role: string;
  submissions: number;
  responseRate: string;
}

const NAMES = ["Rajesh Venkataraman", "Priya Raman", "Karthik Iyer", "Nisha Patel"];
const ROLES = ["Java Developer", "Data Engineer", "Cloud Architect", "QA Automation"];
const DEMO_ROWS: DemoRow[] = Array.from({ length: 1_000 }, (_, index) => ({
  id: `demo-${index + 1}`,
  candidate: NAMES[index % NAMES.length]!,
  role: ROLES[index % ROLES.length]!,
  submissions: (index * 7) % 41,
  responseRate: `${(8 + ((index * 3) % 24)).toFixed(1)}%`,
}));

const COLUMNS: ColumnDef<DemoRow, unknown>[] = [
  { accessorKey: "candidate", header: "Candidate", size: 260 },
  { accessorKey: "role", header: "Primary role", size: 220 },
  {
    accessorKey: "submissions",
    header: "Submissions",
    size: 140,
    cell: ({ getValue }) => <span className="tabular">{String(getValue())}</span>,
  },
  {
    accessorKey: "responseRate",
    header: "Response rate",
    size: 160,
    cell: ({ getValue }) => <span className="tabular">{String(getValue())}</span>,
  },
];

const AGENT_STAGES = [
  "Reading the candidate record",
  "Extracting job requirements",
  "Matching experience",
  "Drafting tailored claims",
] as const;

export function StageOneShowcase() {
  const [status, setStatus] = React.useState<AgentRunStatus>("idle");
  const [activeStage, setActiveStage] = React.useState(0);
  const [elapsedMs, setElapsedMs] = React.useState(0);
  const [draft, setDraft] = React.useState("");
  const tailorMutation = useTailorResume();
  const abortRef = React.useRef<AbortController | null>(null);
  const timersRef = React.useRef<number[]>([]);

  const clearTimers = React.useCallback(() => {
    timersRef.current.forEach((timer) => window.clearInterval(timer));
    timersRef.current = [];
  }, []);

  React.useEffect(() => clearTimers, [clearTimers]);

  async function runAgent() {
    clearTimers();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("running");
    setActiveStage(0);
    setElapsedMs(0);
    setDraft("");

    const startedAt = performance.now();
    timersRef.current.push(
      window.setInterval(() => setElapsedMs(performance.now() - startedAt), 100),
      window.setInterval(
        () => setActiveStage((current) => Math.min(current + 1, AGENT_STAGES.length - 1)),
        800,
      ),
    );

    try {
      const result = await tailorMutation.mutateAsync({
        input: { resumeVersionId: "resume-version-demo", jobId: "job-demo" },
        signal: controller.signal,
      });
      clearTimers();
      setStatus("complete");
      setActiveStage(AGENT_STAGES.length);
      setDraft(result.lines[0]?.text ?? "Draft ready for review.");
    } catch (error) {
      clearTimers();
      if (controller.signal.aborted) {
        setStatus("idle");
        return;
      }
      setStatus("fallback");
      setDraft(error instanceof Error ? error.message : "Continue with the manual editor.");
    }
  }

  function cancelAgent() {
    abortRef.current?.abort();
    clearTimers();
    setStatus("idle");
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="data-table-showcase">
        <div className="mb-3">
          <h2 id="data-table-showcase" className="text-h2 text-[var(--color-text)]">
            Shared DataTable
          </h2>
          <p className="mt-1 text-body text-[var(--color-text-3)]">
            One thousand virtualised rows with sorting, filtering, selection, column visibility, and keyboard navigation.
          </p>
        </div>
        <DataTable
          columns={COLUMNS}
          data={DEMO_ROWS}
          virtualise
          density="compact"
          storageKey="design-system-demo-table"
          searchPlaceholder="Filter the demo rows"
          getRowId={(row) => row.id}
        />
      </section>

      <section aria-labelledby="agent-showcase" className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 id="agent-showcase" className="text-h2 text-[var(--color-text)]">
                AI theatre kit
              </h2>
              <p className="mt-1 text-body text-[var(--color-text-3)]">
                The mock agent takes 2–5 seconds and occasionally falls back to manual editing.
              </p>
            </div>
            <Button
              size="sm"
              variant={status === "running" ? "secondary" : "primary"}
              onClick={status === "running" ? cancelAgent : runAgent}
            >
              {status === "running" ? <Square size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
              {status === "running" ? "Cancel" : "Run demo"}
            </Button>
          </div>
          <AgentRunPanel
            title="Tailoring resume"
            stages={AGENT_STAGES}
            activeStage={activeStage}
            status={status}
            elapsedMs={elapsedMs}
            onCancel={cancelAgent}
          />
        </div>

        <div className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-h3 text-[var(--color-text)]">Generated draft</h3>
          </div>
          {draft ? (
            <p className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-body text-[var(--color-text)]">{draft}</p>
          ) : (
            <p className="text-body text-[var(--color-text-3)]">
              Run the demo to stream a deterministic draft here.
            </p>
          )}
          {draft && status === "complete" ? (
            <p className="text-caption text-[var(--color-text-3)]">
              <TypewriterText text="Draft complete. Read the wording over before you send it." />
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
