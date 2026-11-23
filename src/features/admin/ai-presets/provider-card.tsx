"use client";

import { KeyRound } from "lucide-react";
import { useState } from "react";
import { ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/ui/section-card";
import { Select } from "@/components/ui/select";
import { Tag } from "@/components/ui/tag";
import { useSaveAiProvider } from "@/lib/hooks/use-ai-presets";
import type { AiSetup } from "@/lib/schemas/ai-presets";
import { Field, errorMessage, fieldAria } from "../admin-dialog";
import { ErrorNote } from "@/components/app/error-note";

/** The one provider and key. A save tests the key and every active model first; the key is never shown again. */
export function ProviderCard({ setup, canEdit }: { setup: AiSetup; canEdit: boolean }) {
  const save = useSaveAiProvider();
  const [provider, setProvider] = useState(setup.provider.provider);
  const [apiKey, setApiKey] = useState("");
  const isUnreachable = save.error instanceof ApiError && save.error.status === 409;

  function submit(force: boolean) {
    save.mutate({ provider, apiKey: apiKey.trim(), force }, { onSuccess: () => setApiKey("") });
  }

  return (
    <SectionCard
      icon={KeyRound}
      title="Provider and API key"
      action={setup.provider.isKeySet ? <Tag tone="green">Key set · ending {setup.provider.keyLast4}</Tag> : <Tag tone="amber">No key</Tag>}
    >
      <div className="space-y-3">
        <Field id="ai-provider" label="Provider">
          <Select
            value={provider}
            options={setup.providers.map((option) => ({ value: option.id, label: option.label }))}
            onValueChange={setProvider}
            aria-label="AI provider"
            disabled={!canEdit}
          />
        </Field>
        {canEdit ? (
          <Field id="ai-key" label={setup.provider.isKeySet ? "Replace API key" : "API key"} hint="Saving tests the key and every active model. Stored encrypted.">
            <Input {...fieldAria("ai-key", null, true)} type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
          </Field>
        ) : null}
        <ErrorNote text={errorMessage(save.error)} />
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button disabled={save.isPending || (!apiKey.trim() && !setup.provider.isKeySet)} onClick={() => submit(false)}>
              {save.isPending ? "Testing…" : "Test and save"}
            </Button>
            {isUnreachable ? <Button variant="secondary" disabled={save.isPending} onClick={() => submit(true)}>Save anyway</Button> : null}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
