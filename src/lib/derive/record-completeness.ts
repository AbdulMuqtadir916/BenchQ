import type { Record_, RecordCompleteness } from "@/lib/schemas/record";

interface Check {
  field: string;
  label: string;
  severity: "BLOCKER" | "IMPORTANT" | "MINOR";
  present: (r: Record_) => boolean;
  weight: number;
}

const CHECKS: Check[] = [
  { field: "headline", label: "Headline", severity: "IMPORTANT", weight: 10, present: (r) => !!r.headline },
  { field: "summary", label: "Professional summary", severity: "IMPORTANT", weight: 15, present: (r) => !!r.summary },
  { field: "experiences", label: "Work experience", severity: "BLOCKER", weight: 30, present: (r) => r.experiences.length > 0 },
  { field: "skills", label: "Skills", severity: "BLOCKER", weight: 25, present: (r) => r.skills.length >= 3 },
  { field: "educations", label: "Education", severity: "IMPORTANT", weight: 20, present: (r) => r.educations.length > 0 },
];

/**
 * Derive record completeness as a weighted percentage plus the list of what's missing.
 * Computed, never stored.
 */
export function deriveRecordCompleteness(record: Record_): RecordCompleteness {
  let earned = 0;
  const missing: RecordCompleteness["missing"] = [];

  for (const check of CHECKS) {
    if (check.present(record)) {
      earned += check.weight;
    } else {
      missing.push({ field: check.field, label: check.label, severity: check.severity });
    }
  }

  return {
    percent: Math.min(100, Math.round(earned)),
    missing,
  };
}
