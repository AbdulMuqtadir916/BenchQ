import type { Candidate, CreateCandidate, ReassignCandidate, UpdateCandidate } from "@/lib/schemas/candidate";
import { arrayOf } from "./client";
import { CandidateDto, toBackendAssign, toBackendCreateCandidate, toBackendUpdateCandidate, toCandidate } from "./dto/candidates";
import { toBackendId } from "./dto/demo-ids";
import { http } from "./http";

/** backend/api/routes_candidates.py (docs/candidate-onboarding/06-backend.md §5). The backend scopes the list (Q47). */
const path = (firmId: string, id?: string) => `/api/firms/${toBackendId(firmId)}/candidates${id ? `/${toBackendId(id)}` : ""}`;
const live = {
  list: async (firmId: string) => (await http.get(path(firmId), arrayOf(CandidateDto))).map(toCandidate),
  byId: async (firmId: string, id: string) => toCandidate(await http.get(path(firmId, id), CandidateDto)),
  create: async (firmId: string, body: CreateCandidate) => toCandidate(await http.post(path(firmId), CandidateDto, { body: toBackendCreateCandidate(body) })),
  update: async (firmId: string, id: string, patch: UpdateCandidate) => toCandidate(await http.patch(path(firmId, id), CandidateDto, { body: toBackendUpdateCandidate(patch) })),
  reassign: async (firmId: string, id: string, body: ReassignCandidate) => toCandidate(await http.post(`${path(firmId, id)}/assign`, CandidateDto, { body: toBackendAssign(body) })),
};

/**
 * Firm-scoped (docs/07 T5): every call names the firm, and the backend serves only that firm's candidates, in the
 * principal's scope. Candidates come only from the backend: there is no mock (decided 2026-11-11). A BDE's candidates
 * follow a new manager on the backend itself (PATCH …/members/{id}/manager), so nothing here moves them.
 */
export const candidatesApi = {
  list: (firmId: string): Promise<Candidate[]> => live.list(firmId),

  byId: (firmId: string, id: string): Promise<Candidate> => live.byId(firmId, id),

  create: (firmId: string, body: CreateCandidate): Promise<Candidate> => live.create(firmId, body),

  update: (firmId: string, id: string, body: UpdateCandidate): Promise<Candidate> => live.update(firmId, id, body),

  /** Move a candidate to another manager and/or BDE (07 Q43). Applications, résumés and history stay with it. */
  reassign: (firmId: string, id: string, body: ReassignCandidate): Promise<Candidate> => live.reassign(firmId, id, body),
};
