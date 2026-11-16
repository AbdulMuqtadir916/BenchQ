import { formatInTimeZone } from "date-fns-tz";

const CHECK_EVERY_MS = 60_000;

/** Today's date in a time zone, as yyyy-MM-dd. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return formatInTimeZone(now, timeZone, "yyyy-MM-dd");
}

/**
 * Calls `onDay` with the zone's new date when its midnight passes, checked once a minute, until the returned function is
 * called. `shown` is the date the caller has now: if midnight passed between reading it and starting to watch, `onDay`
 * is called straight away. The calendar runs it while it is open, so "Today" and the newest selectable day move on with
 * the clock.
 */
export function watchToday(timeZone: string, shown: string, onDay: (day: string) => void): () => void {
  let last = shown;
  const check = () => {
    const day = todayIn(timeZone);
    if (day !== last) {
      last = day;
      onDay(day);
    }
  };
  check();
  const timer = setInterval(check, CHECK_EVERY_MS);
  return () => clearInterval(timer);
}
