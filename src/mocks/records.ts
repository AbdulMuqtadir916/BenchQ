import { arrayOf } from "@/lib/api/client";
import { RecordSchema, type Record_ } from "@/lib/schemas/record";
import recordsSeed from "./data/records.json";
import { inFirm, mockResult, notFound } from "./_shared";
import { table } from "./db";
import { firmScoped } from "./membership";

/** Every firm's candidate records; a new candidate's is added by `candidatesMock.create`. */
export const allRecords: Record_[] = table("records", RecordSchema, () => arrayOf(RecordSchema).parse(recordsSeed));

export const recordsMock = firmScoped("records", {
  byCandidate: (firmId: string, candidateId: string): Promise<Record_> =>
    mockResult(inFirm(allRecords, firmId).find((item) => item.candidateId === candidateId) ?? notFound("Candidate record", candidateId)),
});
