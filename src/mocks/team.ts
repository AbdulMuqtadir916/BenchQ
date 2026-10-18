import { z } from "zod";
import { ApiError, arrayOf } from "@/lib/api/client";
import { FirmSchema, UserSchema, type Firm, type User } from "@/lib/schemas/session";
import firmSeed from "./data/firm.json";
import { DEV_FIRM_ID, mockResult } from "./_shared";

const seed = z.object({ firms: arrayOf(FirmSchema), users: arrayOf(UserSchema) }).parse(firmSeed);

/** Every firm and every firm user, validated. */
export const firms: Firm[] = seed.firms;
export const allUsers: User[] = seed.users;

/** The firm the single-firm UI shows until Phase T PR 2 (see DEV_FIRM_ID). */
export const firm: Firm = firms.find((item) => item.id === DEV_FIRM_ID) ?? (() => { throw new Error(`Fixture firm ${DEV_FIRM_ID} missing`); })();
export const users: User[] = allUsers.filter((user) => user.firmId === DEV_FIRM_ID);

export function currentUser(): User {
  const user = users.find((item) => item.id === "user_adnan");
  if (!user) throw new ApiError("Current user not found.", "SESSION_NOT_FOUND", 500);
  return user;
}

export const teamMock = {
  list: (): Promise<User[]> => mockResult(users),
};
