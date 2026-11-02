import { z } from "zod";
import { http } from "./http";

const RequestResult = z.object({ message: z.string() });

export const passwordResetApi = {
  request: async (email: string): Promise<void> => {
    await http.post("/api/auth/password-reset/request", RequestResult, { body: { email } });
  },
  complete: async (input: { token: string; password: string; passwordConfirmation: string }): Promise<void> => {
    await http.post("/api/auth/password-reset/complete", z.undefined(), {
      body: { token: input.token, password: input.password, password_confirmation: input.passwordConfirmation },
    });
  },
};
