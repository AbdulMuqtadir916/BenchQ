import { describe, expect, it } from "vitest";
import { clockLabel, workHoursLabel, workHoursProblem } from "./work-hours";

describe("a firm's work hours (07 Q67)", () => {
  it("are required as HH:MM and can't start and end at once, worded as the backend", () => {
    expect(workHoursProblem("18:30", "04:00")).toBeNull();
    expect(workHoursProblem("", "04:00")).toBe("Enter the work hours' start and end as HH:MM.");
    expect(workHoursProblem("25:00", "04:00")).toBe("Enter the work hours' start and end as HH:MM.");
    expect(workHoursProblem("09:00", "09:00")).toBe("The work hours can't start and end at the same time.");
  });

  it("read as a 12-hour clock", () => {
    expect(clockLabel("00:05")).toBe("12:05 AM");
    expect(clockLabel("12:00")).toBe("12:00 PM");
    expect(workHoursLabel("18:30", "04:00")).toBe("6:30 PM – 4:00 AM");
  });
});
