/**
 * Where the server reaches the backend. `BACKEND_URL` in `.env.local`; in development it defaults to the
 * local compose backend, so a fresh clone works after `docker compose up -d db backend`. In production it
 * must be set (next.config.ts does the same for the `/api` proxy).
 */
export const DEV_BACKEND_URL = "http://localhost:8000";

export function backendUrl(): string | undefined {
  return process.env.BACKEND_URL || (process.env.NODE_ENV === "production" ? undefined : DEV_BACKEND_URL);
}
