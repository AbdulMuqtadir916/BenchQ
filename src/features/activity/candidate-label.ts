import { UNNAMED_CANDIDATE } from "@/lib/api/dto/ledger";

/** The Candidate column: a dash for an entry about no candidate, the name for one with a name, and a plain label when the
 * candidate has no name on their résumé (or can no longer be found), so a blank cell never looks like "no candidate". */
export function candidateLabel(entry: { candidateId?: string | null; candidateName?: string | null }): string {
  if (!entry.candidateId) return "—";
  return entry.candidateName?.trim() || UNNAMED_CANDIDATE;
}

/** What the picker says for the candidate picked when the list doesn't have them: their name from the rows on show. */
export const PICKED_CANDIDATE = "Picked candidate";

/**
 * The candidate picker's options. The candidate in the URL is always one of them, so the picker never reads "All
 * candidates" while the log is narrowed to one (issue #152); when the list doesn't have them, their name comes from the
 * rows on show.
 */
export function candidateOptions(
  list: readonly { id: string; name: string }[],
  picked: string | undefined,
  rows: readonly { candidateId?: string | null; candidateName?: string | null }[],
): { value: string; label: string }[] {
  const options = [{ value: "ALL", label: "All candidates" }, ...list.map((candidate) => ({ value: candidate.id, label: candidate.name }))];
  if (picked === undefined || list.some((candidate) => candidate.id === picked)) return options;
  const row = rows.find((entry) => entry.candidateId === picked);
  return [...options, { value: picked, label: row ? candidateLabel(row) : PICKED_CANDIDATE }];
}
