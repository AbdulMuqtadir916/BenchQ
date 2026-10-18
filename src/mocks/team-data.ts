import { z } from "zod";
import { arrayOf } from "@/lib/api/client";
import { FirmSchema, UserSchema, type Firm, type User } from "@/lib/schemas/session";
import firmSeed from "./data/firm.json";
import { table } from "./db";

/**
 * Every firm and every firm user, validated. Kept apart from the team mock so the mock backend's
 * auth state (auth.ts) can read users without importing a firm-scoped mock: auth → team → membership
 * → auth was an import cycle, which can deadlock concurrent first loads (it did under Vitest).
 */
const fixture = () => z.object({ firms: arrayOf(FirmSchema), users: arrayOf(UserSchema) }).parse(firmSeed);

/** Persisted tables (src/mocks/db.ts): the fixtures until this browser changes them. */
export const firms: Firm[] = table("firms", FirmSchema, () => fixture().firms);
export const allUsers: User[] = table("users", UserSchema, () => fixture().users);
