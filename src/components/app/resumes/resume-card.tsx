import Link from "next/link";
import { Eye, FileCheck2, FileUser, CircleHelp, ShieldCheck } from "lucide-react";
import type { Resume } from "@/lib/schemas/resume";
import type { Candidate } from "@/lib/schemas/candidate";
import { deriveExportGate } from "@/lib/derive";
import { formatRelative } from "@/lib/format/timezone";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/cn";
import { useHref } from "@/lib/routes/use-href";

/** One resume as a card — name, candidate, role, and identifying metadata. */
export function ResumeCard({ resume, candidate }: { resume: Resume; candidate: Candidate | undefined }) {
  const toHref = useHref();
  const version = resume.versions.find((v) => v.id === resume.latestVersionId) ?? resume.versions[0];
  if (!version) return null;
  const gate = deriveExportGate(version);
  const Icon = resume.isMaster ? FileUser : FileCheck2;
  const template = resume.templateId.replace("template_", "");

  return (
    <article className="bq-card group relative flex w-full flex-col gap-3 p-4 transition-shadow hover:shadow-[var(--shadow-md)] has-[a:focus-visible]:shadow-[var(--shadow-md)]">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-lg)]",
            resume.isMaster
              ? "bg-[var(--color-primary-subtle)] text-[var(--color-primary-subtle-fg)]"
              : "bg-[var(--color-info-bg)] text-[var(--color-info-fg)]",
          )}
        >
          <Icon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-h3 text-[var(--color-text)]">
            {/* Stretched link: the whole card opens the builder. */}
            <Link
              href={toHref("resumes.studio", { id: resume.id })}
              className="after:absolute after:inset-0 after:rounded-[var(--radius-lg)] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-[var(--color-focus-ring)]"
            >
              {resume.name}
            </Link>
          </h3>
          <p className="truncate text-body text-[var(--color-text-2)]">{candidate?.fullName ?? "Unknown candidate"}</p>
          <p className="truncate text-caption text-[var(--color-text-3)]">{candidate?.primaryRole ?? "No role set"}</p>
        </div>
        <Link
          href={toHref("resumes.studio", { id: resume.id }, { mode: "view" })}
          aria-label={`View ${resume.name} for ${candidate?.fullName ?? "candidate"}`}
          title="View the resume"
          className="bq-secondary relative z-10 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 text-sm"
        >
          <Eye size={14} aria-hidden />
          View
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Tag tone={resume.isMaster ? "blue" : "teal"}>{resume.isMaster ? "Master" : "Tailored"}</Tag>
        <Tag>v{version.versionNumber}</Tag>
        <Tag tone={(version.atsScore ?? 0) >= 75 ? "green" : "amber"}>ATS {version.atsScore ?? "—"}</Tag>
        <Tag>{template}</Tag>
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-[var(--color-border)] pt-3 text-caption">
        {gate.canExport ? (
          <span className="inline-flex items-center gap-1 text-[var(--color-verified-fg)]"><ShieldCheck size={12} aria-hidden />Ready to export</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[var(--color-unverified-fg)]"><CircleHelp size={12} aria-hidden />{gate.unverifiedCount} unverified {gate.unverifiedCount === 1 ? "claim" : "claims"}</span>
        )}
        <span className="text-[var(--color-text-3)]">Edited {formatRelative(version.createdAt)}</span>
      </div>
    </article>
  );
}
