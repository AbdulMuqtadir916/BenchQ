/**
 * Fixed lists and limits for the new-candidate flow (docs/candidate-onboarding/04-wizard-steps.md). Suggestions are
 * starting points the person can ignore; they are never filled in for them.
 */

/** Step 1: the résumé file the parser accepts (06-backend.md §4, the same limits). */
export const RESUME_FILE = {
  maxBytes: 10 * 1024 * 1024,
  extensions: [".pdf", ".doc", ".docx"],
  mimeTypes: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
} as const;

/** Why a file can't be read, before it is sent; null when it can. Word and PDF only, up to 10 MB. */
export function resumeFileProblem(file: { name: string; size: number; type: string }): string | null {
  const name = file.name.toLowerCase();
  const isKnownType = (RESUME_FILE.mimeTypes as readonly string[]).includes(file.type) || RESUME_FILE.extensions.some((extension) => name.endsWith(extension));
  if (!isKnownType) return "PDF or Word only.";
  if (file.size > RESUME_FILE.maxBytes) return "Up to 10 MB.";
  return null;
}

/** Step 4: common US hubs for preferred locations. */
export const LOCATION_SUGGESTIONS = ["Dallas, TX", "Austin, TX", "Charlotte, NC", "New Jersey", "Chicago, IL", "Bay Area, CA"] as const;

export const INDUSTRY_SUGGESTIONS = ["Banking", "Healthcare", "Insurance", "Retail", "Telecom", "Public sector"] as const;

export const DEAL_BREAKER_SUGGESTIONS = ["No 100% onsite", "No contracts under 6 months", "No night shifts", "No relocation"] as const;

/** Step 2: skills offered when the résumé gave none. */
export const SKILL_SUGGESTIONS = ["Java", "Spring Boot", "React", "AWS", "Python", "SQL"] as const;

/** Longest free-text notes (the handoff note uses the same, docs/02 §4). */
export const NOTE_MAX_LENGTH = 1000;
