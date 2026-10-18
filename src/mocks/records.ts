import { arrayOf } from "@/lib/api/client";
import { RecordSchema, type Record_ } from "@/lib/schemas/record";
import recordsSeed from "./data/records.json";
import { inDevFirm, mockResult, notFound } from "./_shared";

export const allRecords: Record_[] = arrayOf(RecordSchema).parse(recordsSeed);
const records: Record_[] = inDevFirm(allRecords);

export const recordsMock = {
  byCandidate: (candidateId: string): Promise<Record_> =>
    mockResult(records.find((item) => item.candidateId === candidateId) ?? notFound("Candidate record", candidateId)),
};
