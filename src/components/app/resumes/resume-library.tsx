"use client";

import { useMemo, useState } from "react";
import { FileText, Search } from "lucide-react";
import type { ResumeShelf } from "@/lib/schemas/resume";
import type { Candidate } from "@/lib/schemas/candidate";
import { buildResumeTree } from "@/lib/derive/resume-tree";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { PageHeader } from "@/components/app/page-header";
import { ResumeTree } from "./resume-tree";
import type { TreeActions } from "./base-folder";
import { useTreeLabels } from "./use-tree-labels";

export function ResumeLibrary({
  shelf,
  candidates,
  isLoading,
  error,
  onRetry,
  canSeeHidden,
  actions,
}: {
  shelf: ResumeShelf;
  candidates: Candidate[];
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  canSeeHidden: (candidateId: string) => boolean;
  actions?: TreeActions;
}) {
  const labels = useTreeLabels();
  const [query, setQuery] = useState("");
  const [showTailored, setShowTailored] = useState(true);
  const [candidateId, setCandidateId] = useState("all");

  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const tree = useMemo(() => buildResumeTree(shelf, candidates.map((c) => c.id)), [shelf, candidates]);
  const candidateOptions = useMemo(() => [
    { value: "all", label: "All candidates" },
    ...tree.map((t) => ({ value: t.candidateId, label: byId.get(t.candidateId)?.fullName ?? "Unknown candidate" })),
  ], [tree, byId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tree.filter((t) => {
      if (candidateId !== "all" && t.candidateId !== candidateId) return false;
      if (!q) return true;
      const c = byId.get(t.candidateId);
      const names = t.bases.map((b) => b.resume?.name);
      return [c?.fullName, c?.primaryRole, ...names].some((f) => f?.toLowerCase().includes(q));
    });
  }, [tree, byId, query, candidateId]);

  const isFiltered = query.trim() !== "" || candidateId !== "all";

  function reset() {
    setQuery("");
    setCandidateId("all");
  }

  return (
    <div className="bq-page bq-page-wide">
      <PageHeader
        title="Resume Builder"
        subtitle="Every candidate's base résumés, their versions, and the copies tailored from each."
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-3)]" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by candidate, role or résumé" aria-label="Search resumes" className="pl-8" />
        </div>
        <Select className="w-48" aria-label="Filter by candidate" value={candidateId} options={candidateOptions} onValueChange={setCandidateId} />
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-2)]">
          <Checkbox checked={showTailored} onChange={(e) => setShowTailored(e.target.checked)} />
          Show tailored
        </label>
        {isFiltered ? <Button variant="ghost" size="sm" onClick={reset}>Clear</Button> : null}
        {!isLoading && !error ? <span className="ml-auto text-caption text-[var(--color-text-3)] tabular">{filtered.length} of {tree.length} candidates</span> : null}
      </div>

      {error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : isLoading ? (
        <div role="status" aria-busy="true" aria-label="Loading resumes" className="space-y-6">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        isFiltered ? (
          <EmptyState variant="filtered" icon={Search} title="No resumes match" description="Try a different search or clear the filters." action={<Button variant="secondary" onClick={reset}>Clear filters</Button>} />
        ) : (
          <EmptyState icon={FileText} title="No resumes yet" description="A candidate's first base résumé is made when they're added; a later one is uploaded on the candidate's page." />
        )
      ) : (
        <ResumeTree
          tree={filtered}
          labels={labels}
          showTailored={showTailored}
          canSeeHidden={canSeeHidden}
          actions={actions}
          candidateHeading={(id) => {
            const c = byId.get(id);
            return c ? { name: c.fullName, role: c.primaryRole } : { name: "Unknown candidate", role: null };
          }}
        />
      )}
    </div>
  );
}
