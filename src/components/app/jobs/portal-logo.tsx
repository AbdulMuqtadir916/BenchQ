"use client";

import { Building2, Globe2 } from "lucide-react";
import type { Job } from "@/lib/schemas/job";

/**
 * Where a job came from, as the backend says (docs/02 §6.z): never a guessed job board. A search's jobs come through
 * freehire.me; a capture is by hand or from the extension. "Company site" is the employer's own mark in a preview.
 */
export type PortalKey = "FREEHIRE" | "OTHER_SOURCE" | "MANUAL" | "EXTENSION" | "COMPANY";

export const PORTALS: Record<PortalKey, { label: string; logo?: string; color: string }> = {
  FREEHIRE: { label: "freehire.me", color: "var(--color-primary)" },
  OTHER_SOURCE: { label: "Job search", color: "var(--color-primary)" },
  MANUAL: { label: "Added by hand", color: "var(--color-text-2)" },
  EXTENSION: { label: "From the extension", color: "var(--color-text-2)" },
  COMPANY: { label: "Company site", color: "var(--color-text-2)" },
};

/** The sources a job list can be filtered by. */
export const SOURCE_KEYS = ["FREEHIRE", "MANUAL", "EXTENSION"] as const satisfies readonly PortalKey[];

export function portalForJob(job: Job): PortalKey {
  if (job.provenance.sourceType === "MANUAL") return "MANUAL";
  if (job.provenance.sourceType === "USER_SUBMITTED") return "EXTENSION";
  return job.provenance.sourceId === "freehire" ? "FREEHIRE" : "OTHER_SOURCE";
}

export function PortalLogo({ portal, domain, size = 24 }: { portal: PortalKey; domain?: string | null; size?: number }) {
  const config = PORTALS[portal];
  const companyFavicon = domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64` : null;
  const src = config.logo ?? companyFavicon;
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-xs)]"
      style={{ width: size, height: size, color: config.color }}
      aria-hidden="true"
    >
      {portal === "COMPANY" || portal === "MANUAL" || portal === "EXTENSION" ? <Building2 size={Math.round(size * 0.56)} /> : <Globe2 size={Math.round(size * 0.5)} />}
      {src ? (
        // Brand marks use canonical assets; the icon fallback remains legible offline.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="absolute inset-[4px] h-[calc(100%-8px)] w-[calc(100%-8px)] object-contain"
          onError={(event) => { event.currentTarget.style.display = "none"; }}
        />
      ) : null}
    </span>
  );
}
