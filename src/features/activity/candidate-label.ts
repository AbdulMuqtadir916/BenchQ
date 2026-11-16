import { UNNAMED_CANDIDATE } from "@/lib/api/dto/ledger";

/** The Candidate column: a dash for an entry about no candidate, the name for one with a name, and a plain label when the
 * candidate has no name on their résumé (or can no longer be found), so a blank cell never looks like "no candidate". */
export function candidateLabel(entry: { candidateId?: string | null; candidateName?: string | null }): string {
  if (!entry.candidateId) return "—";
  return entry.candidateName?.trim() || UNNAMED_CANDIDATE;
}
