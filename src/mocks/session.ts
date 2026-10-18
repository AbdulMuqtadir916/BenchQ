import { SessionSchema, type Session } from "@/lib/schemas/session";
import { currentUser, firm } from "./team";
import { mockResult } from "./_shared";

/** Seat and candidate usage is derived (src/lib/derive/tenancy.ts), not part of the session. */
export const sessionMock = {
  current: (): Promise<Session> => mockResult(SessionSchema.parse({ user: currentUser(), firm })),
};
