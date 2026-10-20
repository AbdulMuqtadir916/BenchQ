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

/** Rows that belong to one firm. Every firm-scoped mock call filters through this (docs/07 T5). */
export function inFirm<T extends { firmId: string | null }>(rows: readonly T[], firmId: string): T[] {
  return rows.filter((row) => row.firmId === firmId);
}

/**
 * One row of a firm by id. A row of another firm is a 404, exactly like a missing one, so a caller can
 * never learn that a record exists in someone else's firm (docs/07 principle 4).
 */
export function findInFirm<T extends { id: string; firmId: string | null }>(rows: readonly T[], firmId: string, id: string, resource: string): T {
  return rows.find((row) => row.id === id && row.firmId === firmId) ?? notFound(resource, id);
}

export function notFound(resource: string, id: string): never {
  throw new ApiError(`${resource} ${id} not found.`, "NOT_FOUND", 404);
}

let sequence = 0;
/** A new record id, e.g. `cand_mf3k2a0`: unique within this browser's demo data. */
export function newId(prefix: string, now = new Date()): string {
  return `${prefix}_${now.getTime().toString(36)}${(sequence++).toString(36)}`;
}
