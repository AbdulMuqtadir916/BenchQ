import { ApiError } from "@/lib/api/client";
import { describeError, screenErrorText, waitPhrase, type ErrorText } from "@/lib/api/error-text";

/** Any failed sign-in reads the same, so the page never reveals which emails have an account (docs/07 L1). */
export const INVALID_SIGN_IN = "Email or password is incorrect.";

/** Locked out by the backend's throttle (429): trying again at once only keeps the lock, so say how long to wait, from
 * its Retry-After in the shared wording (src/lib/api/error-text.ts `waitPhrase`). The sentence names sign-in attempts
 * rather than the shared "a lot of requests": what was counted here is failed passwords. */
const rateLimited = (retryAfterMs: number | null) =>
  retryAfterMs === null ? "Too many sign-in attempts. Wait a few minutes, then try again." : `Too many sign-in attempts. Try again in ${waitPhrase(retryAfterMs)}.`;

/** What /sign-in says for a failed sign-in. A refused sign-in reads as INVALID_SIGN_IN; the throttle as above; busy,
 * offline, unexpected and out of date read as everywhere else (src/lib/api/error-text.ts); anything else as a plain
 * "try again", which says nothing about the account. */
export function signInError(error: Error): ErrorText {
  if (!(error instanceof ApiError) || error.status === 401) return screenErrorText(INVALID_SIGN_IN);
  if (error.code === "RATE_LIMITED") return screenErrorText(rateLimited(error.retryAfterMs));
  return describeError(error, { screenText: () => "Couldn't sign in right now. Try again." });
}
