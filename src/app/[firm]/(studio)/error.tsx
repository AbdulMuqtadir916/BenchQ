"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/app/error-state";

export default function StudioError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg)]">
      <ErrorState variant="page" error={error} onRetry={retry} />
    </main>
  );
}
