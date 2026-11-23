/**
 * The Batch picker grouped by the candidate's Days (decided 2026-11-17, Q152–Q174). Pure: the backend sends each
 * search's Day and batch number and the Days with work; this lays them out.
 *
 * - Newest Day first: a Day row ("Day 3 · Nov 17–18") picks all its batches (Q166); its batches under it, indented,
 *   newest first ("Batch 4 · 7:42 PM", batch numbers run on across Days, Q158, Q165).
 * - The empty Days between, and up to today, folded into one row each run ("Days 2–39 · no searches", Q172), only
 *   when `showEmptyDays` (the OWNER and MANAGER through `team.view`, Q167): never pickable.
 * - "Earlier searches": batches from before the current assignment, or of a candidate without a BDE, by date and time
 *   only (Q168, Q174).
 * - "All days" last. The newest batch is "NEWEST", so a new search moves the picker to it.
 */
import type { SelectOption } from "@/components/ui/select";
import type { JobSearch, JobSearchWorkday } from "@/lib/schemas/job-search";

export const NEWEST = "NEWEST";
export const ALL_DAYS = "ALL";
const DAY_PREFIX = "day:";

/** What a picked value asks the list for: one batch, one Day, or everything. */
export type DayPick = { batch: string } | { day: number } | Record<string, never>;

export function readPick(value: string, newestBatchId: string | undefined): DayPick {
  if (value === ALL_DAYS) return {};
  if (value === NEWEST) return newestBatchId ? { batch: newestBatchId } : {};
  if (value.startsWith(DAY_PREFIX)) return { day: Number(value.slice(DAY_PREFIX.length)) };
  return { batch: value };
}

const shortDate = (workDate: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${workDate}T00:00:00Z`));

function addDays(workDate: string, days: number): string {
  const date = new Date(`${workDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A work day's dates: "Nov 17–18" when the hours cross midnight, "Nov 17" when they don't (Q165). */
export function dayDates(workDate: string, workday: Pick<JobSearchWorkday, "start" | "end">): string {
  if (workday.end > workday.start) return shortDate(workDate);
  const next = addDays(workDate, 1);
  const [from, to] = [shortDate(workDate), shortDate(next)];
  return from.split(" ")[0] === to.split(" ")[0] ? `${from}–${to.split(" ")[1]}` : `${from} – ${to}`;
}

const clock = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(iso));
const dateAndClock = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone }).format(new Date(iso));

const isFinishedSearch = (search: JobSearch) => search.kind === "SEARCH" && (search.state === "SUCCESS" || search.state === "EMPTY");

/** The work date of Day `day`, from Day 1's. */
const workDateOf = (day: number, dayOne: string) => addDays(dayOne, day - 1);

export function dayOptions(searches: readonly JobSearch[], workday: JobSearchWorkday, { showEmptyDays }: { showEmptyDays: boolean }) {
  const finished = searches.filter(isFinishedSearch).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const numbered = finished.filter((search) => search.day !== null && search.batch !== null);
  const earlier = finished.filter((search) => search.day === null || search.batch === null);
  const newestBatchId = (numbered[0] ?? earlier[0])?.id;
  const valueOf = (search: JobSearch) => (search.id === newestBatchId ? NEWEST : search.id);
  const options: SelectOption[] = [];

  if (workday.dayOne) {
    const dayOne = workday.dayOne;
    const worked = new Set([...workday.daysWorked, ...numbered.map((search) => search.day as number)]);
    const last = Math.max(workday.todayDay ?? 1, ...worked);
    let emptyFrom: number | null = null;
    const closeEmptyRun = (to: number) => {
      if (emptyFrom === null) return;
      const from = emptyFrom;
      emptyFrom = null;
      if (!showEmptyDays) return;
      const label = from === to
        ? `Day ${from} · ${dayDates(workDateOf(from, dayOne), workday)} · no searches`
        : `Days ${to}–${from} · no searches`;
      options.push({ value: `empty:${to}-${from}`, label, disabled: true });
    };
    for (let day = last; day >= 1; day -= 1) {
      if (!worked.has(day)) {
        emptyFrom ??= day;
        if (day === 1) closeEmptyRun(1);
        continue;
      }
      closeEmptyRun(day + 1);
      options.push({ value: `${DAY_PREFIX}${day}`, label: `Day ${day} · ${dayDates(workDateOf(day, dayOne), workday)}` });
      for (const search of numbered.filter((item) => item.day === day)) {
        options.push({ value: valueOf(search), label: `Batch ${search.batch} · ${clock(search.startedAt, workday.timezone)}`, indent: true });
      }
    }
  }
  if (earlier.length > 0) {
    options.push({ value: "earlier", label: "Earlier searches", disabled: true });
    for (const search of earlier) options.push({ value: valueOf(search), label: dateAndClock(search.startedAt, workday.timezone), indent: true });
  }
  options.push({ value: ALL_DAYS, label: "All days" });
  return { options, newestBatchId };
}
