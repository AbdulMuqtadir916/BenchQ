import { z } from "zod";
import { arrayOf } from "@/lib/api/client";
import { FirmSchema, UserSchema, type Firm, type User } from "@/lib/schemas/session";
import firmSeed from "./data/firm.json";

/**
 * Every firm and every firm user, validated. Kept apart from the team mock so the mock backend's
 * auth state (auth.ts) can read users without importing a firm-scoped mock: auth → team → membership
 * → auth was an import cycle, which can deadlock concurrent first loads (it did under Vitest).
 */
const seed = z.object({ firms: arrayOf(FirmSchema), users: arrayOf(UserSchema) }).parse(firmSeed);

export const firms: Firm[] = seed.firms;
export const allUsers: User[] = seed.users;
