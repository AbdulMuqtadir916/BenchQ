import type { Candidate, CreateCandidate, ReassignCandidate, UpdateCandidate } from "@/lib/schemas/candidate";
import { arrayOf } from "./client";
import { isLive } from "./config";
import { CandidateDto, toBackendAssign, toBackendCreateCandidate, toBackendUpdateCandidate, toCandidate } from "./dto/candidates";
import { toBackendId } from "./dto/demo-ids";
import { http } from "./http";

const mock = () => import("@/mocks/candidates").then((m) => m.candidatesMock);

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
 * Firm-scoped (docs/07 T5): every call names the firm, and the backend/mock serves only that firm's rows. Live with
 * `NEXT_PUBLIC_LIVE_MODULES=candidates` (onboarding 07).
 */
export const candidatesApi = {
  list: async (firmId: string): Promise<Candidate[]> => (isLive("candidates") ? live.list(firmId) : (await mock()).list(firmId)),

  byId: async (firmId: string, id: string): Promise<Candidate> => (isLive("candidates") ? live.byId(firmId, id) : (await mock()).byId(firmId, id)),

  create: async (firmId: string, body: CreateCandidate): Promise<Candidate> => (isLive("candidates") ? live.create(firmId, body) : (await mock()).create(firmId, body)),

  update: async (firmId: string, id: string, body: UpdateCandidate): Promise<Candidate> => (isLive("candidates") ? live.update(firmId, id, body) : (await mock()).update(firmId, id, body)),

  /** Move a candidate to another manager and/or BDE (07 Q43). Applications, résumés and history stay with it. */
  reassign: async (firmId: string, id: string, body: ReassignCandidate): Promise<Candidate> => (isLive("candidates") ? live.reassign(firmId, id, body) : (await mock()).reassign(firmId, id, body)),

  /**
   * After a BDE's manager changes, their candidates follow (07 Q43). On mocks only: the backend moves them itself in
   * PATCH …/members/{id}/manager, so live this does nothing.
   */
  followBde: async (firmId: string, bdeId: string, managerId: string): Promise<number> => (isLive("candidates") ? 0 : (await mock()).followBde(firmId, bdeId, managerId)),
};
