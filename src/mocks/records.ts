import { arrayOf } from "@/lib/api/client";
import { RecordSchema, type Record_ } from "@/lib/schemas/record";
import recordsSeed from "./data/records.json";
import { inFirm, mockResult, notFound } from "./_shared";
import { firmScoped } from "./membership";

export const allRecords: Record_[] = arrayOf(RecordSchema).parse(recordsSeed);

export const recordsMock = firmScoped("records", {
  byCandidate: (firmId: string, candidateId: string): Promise<Record_> =>
    mockResult(inFirm(allRecords, firmId).find((item) => item.candidateId === candidateId) ?? notFound("Candidate record", candidateId)),
});
