import { arrayOf } from "@/lib/api/client";
import { CandidateSchema, type Candidate } from "@/lib/schemas/candidate";
import seed from "./candidates.json";

/**
 * TESTS ONLY: the 24 candidates the tests run on. The app never loads them: candidates come only from the backend
 * (decided 2026-11-11, job search PR 3), and `stubBackendReads` answers candidate reads with these in tests.
 */
export const fixtureCandidates: Candidate[] = arrayOf(CandidateSchema).parse(seed);
