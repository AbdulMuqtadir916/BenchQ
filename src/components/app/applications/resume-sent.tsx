import Link from "next/link";
import { Eye, FileCheck2, FileUser, History } from "lucide-react";
import type { Application } from "@/lib/schemas/application";
import type { Resume } from "@/lib/schemas/resume";
import { formatIst } from "@/lib/format/timezone";
import { cn } from "@/lib/cn";
import { Tag } from "@/components/ui/tag";
import { useHref } from "@/lib/routes/use-href";

/** Find the resume and version a submission went out with. */
export function findResumeVersion(resumes: Resume[], versionId: string | null) {
  if (!versionId) return null;
  for (const resume of resumes) {
    const version = resume.versions.find((v) => v.id === versionId);
    if (version) {
      const latest = resume.versions.find((v) => v.id === resume.latestVersionId);
      return { resume, version, latestNumber: latest?.versionNumber ?? version.versionNumber, isLatest: version.id === resume.latestVersionId };
    }
  }
  return null;
}

/**
 * Which resume the client received. Shows the exact version sent, and says so
 * when the resume has been edited since — the client saw the older one.
 */
export function ResumeSent({ application, resumes, isLoading = false, className }: { application: Application; resumes: Resume[]; isLoading?: boolean; className?: string }) {
  const toHref = useHref();
  const sent = findResumeVersion(resumes, application.resumeVersionId);

  if (!application.resumeVersionId) {
    return (
      <p className={cn("rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-3 py-3 text-sm text-[var(--color-text-3)]", className)}>
        Not submitted yet — the resume is picked when you apply.
      </p>
    );
  }
  if (isLoading) return <p className={cn("text-sm text-[var(--color-text-3)]", className)}>Loading resume…</p>;
  if (!sent) {
    return <p className={cn("rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-3 py-3 text-sm text-[var(--color-text-3)]", className)}>The resume sent with this application is no longer available.</p>;
  }

  const Icon = sent.resume.isMaster ? FileUser : FileCheck2;
  const template = sent.version.templateId.replace("template_", "");
  return (
    <div className={cn("rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3", className)}>
      <div className="flex items-start gap-3">
        <span aria-hidden className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)]", sent.resume.isMaster ? "bg-[var(--color-primary-subtle)] text-[var(--color-primary-subtle-fg)]" : "bg-[var(--color-info-bg)] text-[var(--color-info-fg)]")}>
          <Icon size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-strong text-[var(--color-text)]">{sent.resume.name}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Tag tone={sent.resume.isMaster ? "blue" : "teal"}>{sent.resume.isMaster ? "Master" : "Tailored"}</Tag>
            <Tag>v{sent.version.versionNumber}</Tag>
            <Tag>{template}</Tag>
            {sent.version.atsScore !== null ? <Tag tone={sent.version.atsScore >= 75 ? "green" : "amber"}>ATS {sent.version.atsScore}</Tag> : null}
          </div>
          {application.appliedAt ? <p className="mt-1.5 text-caption text-[var(--color-text-3)]">Sent {formatIst(application.appliedAt, "MMM d, yyyy")}</p> : null}
        </div>
        <Link href={toHref("resumes.studio", { id: sent.resume.id }, { mode: "view" })} className="bq-secondary inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 text-sm" aria-label={`View ${sent.resume.name}`}>
          <Eye size={13} aria-hidden />View
        </Link>
      </div>
      {!sent.isLatest ? (
        <p className="mt-2.5 flex items-center gap-1.5 border-t border-[var(--color-border)] pt-2.5 text-caption text-[var(--color-warning-fg)]">
          <History size={12} aria-hidden />Edited since — the client has v{sent.version.versionNumber}, the resume is now v{sent.latestNumber}.
        </p>
      ) : null}
    </div>
  );
}
