"use client";

import { useMemo } from "react";
import { linkQuery, type ApplicationsLink, type CandidatesLink } from "@/lib/derive/list-filters";
import { useHref } from "@/lib/routes/use-href";

/** Whose numbers are on screen: the whole firm, one manager's team, or one BDE. */
export interface LinkScope {
  manager?: string;
  bde?: string;
}

/**
 * Where each number on the Activity dashboard opens: the Applications or Candidates list, filtered so it shows the
 * same records the number counted (the filters use the dashboard's own rules, `lib/derive/list-filters`).
 */
export function useListLinks({ manager, bde }: LinkScope) {
  const toHref = useHref();
  return useMemo(() => ({
    applications: (filters: ApplicationsLink = {}) => toHref("applications", {}, linkQuery({ manager, bde, ...filters })),
    candidates: (filters: CandidatesLink = {}) => toHref("candidates", {}, linkQuery({ manager, bde, ...filters })),
    candidate: (id: string) => toHref("candidates.detail", { id }),
  }), [toHref, manager, bde]);
}

export type ListLinks = ReturnType<typeof useListLinks>;

/** A card or row that opens a list: one look for hover and focus everywhere on the dashboard. */
export const linkSurface = "rounded-[var(--radius-md)] transition-colors hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]";
