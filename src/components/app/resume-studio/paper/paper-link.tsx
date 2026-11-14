import type { PaperLink } from "@/lib/resume-doc/paper-links";
import { cn } from "@/lib/cn";

/** A link on the read-only paper (preview and PDF), with its short label; plain `text` when it isn't a usable link. */
export function PaperAnchor({ link, text, className }: { link: PaperLink | null; text: string; className?: string }) {
  if (!link) return <span className={className}>{text}</span>;
  return (
    <a
      className={cn("rt-link", className)}
      href={link.href}
      title={link.label === text ? undefined : text}
      {...(link.isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {link.label}
    </a>
  );
}
