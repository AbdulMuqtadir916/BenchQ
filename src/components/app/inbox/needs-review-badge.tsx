import { Inbox } from "lucide-react";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/cn";

/** An email waiting for a BDE's decision, or an application held by one (PR 4 review loop). Label + icon + tone. */
export function NeedsReviewBadge({ className, title }: { className?: string; title?: string }) {
  return (
    <Tag tone="violet" title={title} className={cn("max-w-full", className)}>
      <Inbox size={11} aria-hidden />
      <span className="truncate">BDE review</span>
    </Tag>
  );
}
