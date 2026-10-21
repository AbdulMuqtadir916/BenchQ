import type { User } from "@/lib/schemas/session";
import { arrayOf } from "./client";
import { isLive } from "./config";
import { toBackendId } from "./dto/demo-ids";
import { UserDto, toUser } from "./dto/session";
import { http } from "./http";

const mock = () => import("@/mocks/team").then((m) => m.teamMock);

/** Firm-scoped (docs/07 T5): every call names the firm, and the backend/mock serves only that firm's rows. */
export const teamApi = {
  /** On the live backend with the session (a real firm's members come from the backend, not the fixtures). */
  list: async (firmId: string): Promise<User[]> =>
    isLive("session")
      ? (await http.get(`/api/firms/${toBackendId(firmId)}/members`, arrayOf(UserDto))).map(toUser)
      : (await mock()).list(firmId),
};
