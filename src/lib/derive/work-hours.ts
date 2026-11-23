/**
 * A firm's work hours (07 Q67, decided 2026-11-17, Q152–Q174): "HH:MM" in the firm's primary timezone, the end may
 * be past midnight. The same checks and wording as backend/job_search/workday.py `entered_hours`.
 */
import { WorkClockSchema } from "@/lib/schemas/session";

/** Why the entered hours can't be saved, or null. */
export function workHoursProblem(start: string, end: string): string | null {
  if (!WorkClockSchema.safeParse(start).success || !WorkClockSchema.safeParse(end).success) return "Enter the work hours' start and end as HH:MM.";
  if (start === end) return "The work hours can't start and end at the same time.";
  return null;
}

/** "18:30" → "6:30 PM". */
export function clockLabel(clock: string): string {
  const [hour = 0, minute = 0] = clock.split(":").map(Number);
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/** "6:30 PM – 4:00 AM". */
export function workHoursLabel(start: string, end: string): string {
  return `${clockLabel(start)} – ${clockLabel(end)}`;
}
