/** The linked job's details as the panel words them. */

/** Pay under this is per hour. The job pool stores pay without its unit, and no yearly salary is this low. */
const HOURLY_BELOW = 1000;
const DAY_MS = 86_400_000;

const hourly = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const thousands = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const ago = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "$85–$95/hr", "$120k–$150k/yr" or "$90/hr"; null when the posting gave no pay. */
export function payText(min?: number | null, max?: number | null): string | null {
  const given = [min, max].filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (given.length === 0) return null;
  const low = Math.min(...given);
  const high = Math.max(...given);
  const isHourly = high < HOURLY_BELOW;
  const amount = (value: number) => (isHourly ? `$${hourly.format(value)}` : `$${thousands.format(value / 1000)}k`);
  return `${low === high ? amount(high) : `${amount(low)}–${amount(high)}`}${isHourly ? "/hr" : "/yr"}`;
}

/** "Found today", "Found 3 days ago", "Found last month"; null without a date. */
export function foundText(at?: string | null, now = Date.now()): string | null {
  const time = at ? Date.parse(at) : Number.NaN;
  if (!Number.isFinite(time)) return null;
  const days = Math.max(0, Math.floor((now - time) / DAY_MS));
  const [count, unit]: [number, Intl.RelativeTimeFormatUnit] = days < 7 ? [days, "day"]
    : days < 30 ? [Math.floor(days / 7), "week"]
      : days < 365 ? [Math.floor(days / 30), "month"]
        : [Math.floor(days / 365), "year"];
  return `Found ${ago.format(-count, unit)}`;
}

/** The first letter of a name, for the job's tile: by whole characters, so an emoji isn't cut in half. */
export const initialOf = (name: string) => (Array.from(name.trim())[0] ?? "").toUpperCase();
