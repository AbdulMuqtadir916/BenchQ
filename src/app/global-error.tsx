"use client";

import "./globals.css";
import { ErrorState } from "@/components/app/error-state";

/** Last-resort boundary for errors in the root layout. Renders its own document, so it imports the styles itself. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <title>Something went wrong · BenchQ</title>
        <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg)]">
          <ErrorState variant="page" error={error} onRetry={retry} />
        </main>
      </body>
    </html>
  );
}
