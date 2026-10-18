import { z } from "zod";
import { arrayOf } from "@/lib/api/client";
import { FirmSchema, UserSchema, type Firm, type User } from "@/lib/schemas/session";
import firmSeed from "./data/firm.json";
import { inFirm, mockResult } from "./_shared";

const seed = z.object({ firms: arrayOf(FirmSchema), users: arrayOf(UserSchema) }).parse(firmSeed);

/** Every firm and every firm user, validated. */
export const firms: Firm[] = seed.firms;
export const allUsers: User[] = seed.users;

export const teamMock = {
  list: (firmId: string): Promise<User[]> => mockResult(inFirm(allUsers, firmId)),
};
