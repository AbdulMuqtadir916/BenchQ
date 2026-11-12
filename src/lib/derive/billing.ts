import type { Firm } from "@/lib/schemas/session";
import type { BillingPeriod } from "@/lib/schemas/tenancy";

/**
 * Billing arithmetic and flags (docs/02 §3.5, 07 Q64–Q65). Super Admin only: nothing here is for a firm screen. The
 * amount is never typed or stored: it is the BDE count times the price, and the backend writes the same number.
 */

export const CANDIDATES_PER_SEAT = 10;
export const JOBS_PER_CANDIDATE_PER_DAY = 100;
export const BILLING_PERIOD_DAYS = 30;

export const candidateLimitFor = (seatLimit: number): number => CANDIDATES_PER_SEAT * seatLimit;
export const periodAmountCents = (seatLimit: number, priceCentsPerSeat: number): number => seatLimit * priceCentsPerSeat;

/** `3500` → "$35.00"; `35000` → "$350.00". */
export const formatUsd = (cents: number): string => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "35", "35.5" or "$35.00" → cents, or null when it isn't a price. */
export function parseUsdToCents(text: string): number | null {
  const match = /^\$?\s*(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || 0);
}

/** `YYYY-MM-DD` for "today" in India, where the Super Admin works (the backend uses the same day). */
export const todayInIndia = (now: Date): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);

/** The period running on `today` (both ends included), if any. */
export function currentPeriod(periods: readonly BillingPeriod[], today: string): BillingPeriod | null {
  return periods.find((period) => period.startsOn <= today && today <= period.endsOn) ?? null;
}

export type BillingState = "none" | "paid" | "overdue";

/**
 * "No billing period" until the first one starts (an onboarding firm is never overdue). Overdue = the firm has had a
 * period and no PAID period covers today (07 Q65), so a period just started and not yet marked paid counts.
 */
export function billingState(firmId: Firm["id"], periods: readonly BillingPeriod[], today: string): BillingState {
  const own = periods.filter((period) => period.firmId === firmId);
  if (own.length === 0) return "none";
  if (own.some((period) => period.status === "PAID" && period.startsOn <= today && today <= period.endsOn)) return "paid";
  return "overdue";
}

export const isPaymentOverdue = (firmId: Firm["id"], periods: readonly BillingPeriod[], today: string): boolean =>
  billingState(firmId, periods, today) === "overdue";

/** The firm's periods, newest first. */
export const periodsOf = (firmId: Firm["id"], periods: readonly BillingPeriod[]): BillingPeriod[] =>
  periods.filter((period) => period.firmId === firmId).sort((a, b) => (a.startsOn < b.startsOn ? 1 : -1));

/** `2026-11-12` → "12 Nov 2026" (a calendar date, never shifted by the reader's timezone). */
export const formatDay = (day: string): string =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
