import { ApiError } from "@/lib/api/client";

const DEFAULT_DELAY_MS = 60;

function configuredDelay(): number {
  const value = Number(process.env.NEXT_PUBLIC_MOCK_DELAY_MS ?? DEFAULT_DELAY_MS);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_DELAY_MS;
}

export async function wait(ms = configuredDelay(), signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new DOMException("The mock request was cancelled.", "AbortError");
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const cancel = () => {
      clearTimeout(timer);
      reject(new DOMException("The mock request was cancelled.", "AbortError"));
    };
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

/** Resolves like a network call: after a delay, with a copy the caller can't mutate. */
export async function mockResult<T>(value: T, signal?: AbortSignal): Promise<T> {
  await wait(undefined, signal);
  return structuredClone(value);
}

/**
 * TRANSITIONAL (Phase T PR 1 → PR 2). The fixtures now hold several firms, but the session, hooks and
 * query keys stay single-firm until T4–T5. Until then each mock serves only this firm, so the UI shows
 * exactly what it showed before. T5 replaces this with a firmId argument on every adapter; delete it then.
 */
export const DEV_FIRM_ID = "firm_hts";

export function inDevFirm<T extends { firmId: string | null }>(rows: T[]): T[] {
  return rows.filter((row) => row.firmId === DEV_FIRM_ID);
}

export function notFound(resource: string, id: string): never {
  throw new ApiError(`${resource} ${id} not found.`, "NOT_FOUND", 404);
}
