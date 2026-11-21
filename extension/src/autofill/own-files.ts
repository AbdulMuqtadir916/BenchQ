import { useSyncExternalStore } from "react";
import type { ResumeFile } from "./types";

/** The file the BDE picked from their computer for a candidate's forms (Q5), and whether a pick is still being read. It
 * lives here, outside the panel, while the side panel is open: a panel rebuilt when the BDE switches tabs and back finds
 * it again, and every tab and job of that candidate uses it until they remove it (#148's review). Never saved, never
 * sent to BenchQ: it goes when the side panel closes or the BenchQ session ends. `swap`: the pick to put on the form in
 * place of the file BenchQ attached there, once read; whichever panel is open then queues it, and settles it here. */
export type OwnFile = { file: ResumeFile | null; isReading: boolean; swap: number | null };

type Held = OwnFile & { pick: number };

const NONE: Held = { file: null, isReading: false, swap: null, pick: 0 };
const held = new Map<string, Held>();
const listeners = new Set<() => void>();
// Every pick and Remove takes the next number, for every candidate and across sessions, so a read still running for an
// earlier one can never pass for a later one's, even after the session's files were forgotten (#148's review).
let sequence = 0;

const heldFor = (candidateId: string) => held.get(candidateId) ?? NONE;

function put(candidateId: string, next: Held) {
  held.set(candidateId, next);
  listeners.forEach((listener) => listener());
}

/** A pick starts being read: nothing fills meanwhile. `swap`: BenchQ's file is on the form, and this one replaces it
 * once read. Each pick and each Remove counts, so the last one wins. */
export function startOwnFile(candidateId: string, swap = false): number {
  sequence += 1;
  put(candidateId, { ...heldFor(candidateId), isReading: true, swap: swap ? sequence : null, pick: sequence });
  return sequence;
}

/** A pick's read settled: its file, or none when it couldn't be read (the file before stays, and nothing is swapped).
 * False when a later pick or Remove came meanwhile: this one is dropped. */
export function finishOwnFile(candidateId: string, pick: number, file: ResumeFile | null): boolean {
  const now = heldFor(candidateId);
  if (now.pick !== pick) return false;
  put(candidateId, { file: file ?? now.file, isReading: false, swap: file ? now.swap : null, pick });
  return true;
}

/** The swap for this pick was queued: no panel, rebuilt or not, queues it again. */
export function settleSwap(candidateId: string, pick: number) {
  const now = heldFor(candidateId);
  if (now.swap === pick) put(candidateId, { ...now, swap: null });
}

/** The BDE stops using their file for this candidate; a read still running for it is dropped. */
export function removeOwnFile(candidateId: string) {
  sequence += 1;
  put(candidateId, { file: null, isReading: false, swap: null, pick: sequence });
}

/** The BenchQ session ended: no candidate's file stays. */
export function forgetOwnFiles() {
  held.clear();
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The candidate's own file as it stands, kept current as picks are read and removed. */
export function useOwnFile(candidateId: string): OwnFile {
  return useSyncExternalStore(subscribe, () => heldFor(candidateId));
}
