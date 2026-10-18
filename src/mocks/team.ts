import type { User } from "@/lib/schemas/session";
import { inFirm, mockResult } from "./_shared";
import { firmScoped } from "./membership";
import { allUsers } from "./team-data";

export { allUsers, firms } from "./team-data";

export const teamMock = firmScoped("team", {
  list: (firmId: string): Promise<User[]> => mockResult(inFirm(allUsers, firmId)),
});
