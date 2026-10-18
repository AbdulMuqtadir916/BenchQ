import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/app/empty-state";

/** Unknown URL, or a record that doesn't exist or is outside the user's scope. */
export function NotFoundState({
  title = "Page not found",
  description = "This page doesn't exist, or the link is out of date.",
  backHref = "/dashboard",
  backLabel = "Go to dashboard",
}: {
  title?: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="bq-page">
      <EmptyState
        icon={SearchX}
        variant="filtered"
        title={title}
        description={description}
        action={
          <Button asChild variant="secondary">
            <Link href={backHref}>{backLabel}</Link>
          </Button>
        }
      />
    </div>
  );
}
