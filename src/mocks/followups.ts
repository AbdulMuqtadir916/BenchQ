import { arrayOf } from "@/lib/api/client";
import { FollowUpTaskSchema, type FollowUpTask } from "@/lib/schemas/application";
import followupsSeed from "./data/followups.json";
import { inFirm, mockResult } from "./_shared";
import { firmScoped } from "./membership";

export const allFollowups: FollowUpTask[] = arrayOf(FollowUpTaskSchema).parse(followupsSeed);
export const followupsMock = firmScoped("followups", {
  list: (firmId: string, params?: { userId?: string }): Promise<FollowUpTask[]> => {
    const followups = inFirm(allFollowups, firmId);
    return mockResult(params?.userId ? followups.filter((task) => task.assignedToUserId === params.userId) : followups);
  },
});
