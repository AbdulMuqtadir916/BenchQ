"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/app/error-state";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="bq-page">
      <ErrorState variant="page" error={error} onRetry={retry} />
    </div>
  );
}
