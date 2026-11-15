import { formatInTimeZone } from "date-fns-tz";

const CHECK_EVERY_MS = 60_000;

/** Today's date in a time zone, as yyyy-MM-dd. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return formatInTimeZone(now, timeZone, "yyyy-MM-dd");
}

/**
 * Calls `onDay` with the zone's new date when its midnight passes, checked once a minute, until the returned function is
 * called. The calendar runs it while it is open, so "Today" and the newest selectable day move on with the clock.
 */
export function watchToday(timeZone: string, onDay: (day: string) => void): () => void {
  let last = todayIn(timeZone);
  const timer = setInterval(() => {
    const day = todayIn(timeZone);
    if (day !== last) {
      last = day;
      onDay(day);
    }
  }, CHECK_EVERY_MS);
  return () => clearInterval(timer);
}
