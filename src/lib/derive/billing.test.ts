import { describe, expect, it } from "vitest";
import type { BillingPeriod } from "@/lib/schemas/tenancy";
import {
  billingState, candidateLimitFor, currentPeriod, formatUsd, isPaymentOverdue, parseUsdToCents, periodAmountCents, periodsOf, todayInIndia,
} from "./billing";

const period = (over: Partial<BillingPeriod> = {}): BillingPeriod => ({
  id: "p1", firmId: "firm_a", startsOn: "2026-11-01", endsOn: "2026-12-01", seatLimit: 10, candidateLimit: 100,
  jobsPerCandidatePerDay: 100, priceCentsPerSeat: 3500, amountCents: 35000, status: "UNPAID", paidOn: null, note: null,
  createdAt: "2026-11-01T00:00:00.000Z", ...over,
});

describe("the arithmetic (07 Q64)", () => {
  it("gives a firm ten candidates per BDE and bills the BDE count times the price", () => {
    expect([10, 12, 1].map(candidateLimitFor)).toEqual([100, 120, 10]);
    expect(periodAmountCents(10, 3500)).toBe(35000);
    expect(periodAmountCents(12, 3500)).toBe(42000);
  });

  it("formats and parses dollars", () => {
    expect(formatUsd(3500)).toBe("$35.00");
    expect(formatUsd(123456)).toBe("$1,234.56");
    expect(["35", "35.5", "$35.00", " 35.05 "].map(parseUsdToCents)).toEqual([3500, 3550, 3500, 3505]);
    expect(["", "abc", "-5", "35.555", "1e3"].map(parseUsdToCents)).toEqual([null, null, null, null, null]);
  });

  it("uses today's date in India", () => {
    expect(todayInIndia(new Date("2026-11-12T20:00:00Z"))).toBe("2026-11-13");   // 01:30 IST, the next day
    expect(todayInIndia(new Date("2026-11-12T10:00:00Z"))).toBe("2026-11-12");
  });
});

describe("the overdue flag (07 Q65)", () => {
  it("is 'none', never overdue, for a firm with no period", () => {
    expect(billingState("firm_a", [], "2026-11-12")).toBe("none");
    expect(billingState("firm_a", [period({ firmId: "firm_b" })], "2026-11-12")).toBe("none");
    expect(isPaymentOverdue("firm_a", [], "2026-11-12")).toBe(false);
  });

  it("is paid while a paid period covers today, both ends included", () => {
    const paid = [period({ status: "PAID", paidOn: "2026-11-02" })];
    expect(billingState("firm_a", paid, "2026-11-01")).toBe("paid");
    expect(billingState("firm_a", paid, "2026-12-01")).toBe("paid");
  });

  it("is overdue when the covering period is unpaid, or the paid one has ended", () => {
    expect(isPaymentOverdue("firm_a", [period()], "2026-11-12")).toBe(true);
    expect(isPaymentOverdue("firm_a", [period({ status: "PAID", paidOn: "2026-11-02" })], "2026-12-02")).toBe(true);
  });

  it("finds the period running today and lists a firm's periods newest first", () => {
    const old = period({ id: "old", startsOn: "2026-10-01", endsOn: "2026-10-31" });
    const now = period({ id: "now" });
    expect(currentPeriod([old, now], "2026-11-12")?.id).toBe("now");
    expect(currentPeriod([old, now], "2027-01-01")).toBeNull();
    expect(periodsOf("firm_a", [old, now, period({ id: "other", firmId: "firm_b" })]).map((p) => p.id)).toEqual(["now", "old"]);
  });
});
