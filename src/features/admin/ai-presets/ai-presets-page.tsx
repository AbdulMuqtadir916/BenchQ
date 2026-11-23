"use client";

import { Sparkles } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { ErrorState } from "@/components/app/error-state";
import { PageHeader } from "@/components/app/page-header";
import { SkeletonList } from "@/components/app/skeleton-list";
import { useCan } from "@/lib/auth/permissions";
import { useAiSetup } from "@/lib/hooks/use-ai-presets";
import { LimitsCard } from "./limits-card";
import { ModelsCard } from "./models-card";
import { ProviderCard } from "./provider-card";
import { UseCaseCard } from "./use-case-card";

/** /admin/ai-presets: the one provider and key, the approved models, each use case's presets, and the limits. */
export function AiPresetsPage() {
  const setup = useAiSetup();
  const canEdit = useCan("ai.manage");

  return (
    <div className="bq-page space-y-4">
      <PageHeader title="AI presets" subtitle="The provider, models and prompts every AI feature runs on. Firms never see this." />
      {setup.isPending ? <SkeletonList rows={6} /> : setup.isError ? (
        <ErrorState error={setup.error} onRetry={() => void setup.refetch()} />
      ) : setup.data.useCases.length === 0 ? (
        <EmptyState icon={Sparkles} title="No AI use cases" description="Restart the backend to create the default presets." />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <ProviderCard setup={setup.data} canEdit={canEdit} />
            <LimitsCard limits={setup.data.limits} canEdit={canEdit} />
          </div>
          <ModelsCard models={setup.data.models} canEdit={canEdit} />
          {setup.data.useCases.map((useCase) => (
            <UseCaseCard key={useCase.key} useCase={useCase} efforts={setup.data.efforts} canEdit={canEdit} />
          ))}
        </>
      )}
    </div>
  );
}
