import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { todayIn, watchToday } from "./today";

// CodeRabbit on #142: a calendar left open across the firm's midnight kept the old day.
describe("the calendar's today", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-15T18:29:00Z"));      // 23:59 in Kolkata
  });
  afterEach(() => vi.useRealTimers());

  it("is the date in the firm's time zone", () => {
    expect(todayIn("Asia/Kolkata")).toBe("2026-11-15");
    expect(todayIn("America/New_York")).toBe("2026-11-15");
    expect(todayIn("Pacific/Kiritimati")).toBe("2026-11-16");
  });

  it("moves on when the firm's midnight passes while the calendar is open", () => {
    const onDay = vi.fn();
    const stop = watchToday("Asia/Kolkata", onDay);
    vi.advanceTimersByTime(30_000);
    expect(onDay).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);                           // 00:00 in Kolkata
    expect(onDay).toHaveBeenCalledExactlyOnceWith("2026-11-16");
    vi.advanceTimersByTime(10 * 60_000);
    expect(onDay).toHaveBeenCalledOnce();                     // same day: no more calls
    stop();
  });

  it("stops watching once the calendar closes", () => {
    const onDay = vi.fn();
    watchToday("Asia/Kolkata", onDay)();
    vi.advanceTimersByTime(5 * 60_000);
    expect(onDay).not.toHaveBeenCalled();
  });
});
