import type { User } from "@/lib/schemas/session";

const mock = () => import("@/mocks/team").then((m) => m.teamMock);

/** Firm-scoped (docs/07 T5): every call names the firm, and the backend/mock serves only that firm's rows. */
export const teamApi = {
  list: async (firmId: string): Promise<User[]> => (await mock()).list(firmId),
};
