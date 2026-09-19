import { describe, expect, it } from "vitest";
import { calendarDateInTimeZone, dayOfWeekInTimeZone, wallTimeOnZonedDate } from "./warehouse-clock";

describe("warehouse-clock", () => {
  it("maps Friday 16:00 America/New_York without a global cutoff hour", () => {
    const at = new Date("2026-09-18T14:00:00.000Z");
    expect(dayOfWeekInTimeZone(at, "America/New_York")).toBe(5);
    expect(calendarDateInTimeZone(at, "America/New_York").isoDate).toBe("2026-09-18");
    expect(wallTimeOnZonedDate(at, "America/New_York", "16:00:00").toISOString()).toBe(
      "2026-09-18T20:00:00.000Z",
    );
  });

  it("maps Friday 14:30 America/Los_Angeles from the warehouse timezone", () => {
    const at = new Date("2026-09-18T18:00:00.000Z");
    expect(dayOfWeekInTimeZone(at, "America/Los_Angeles")).toBe(5);
    expect(wallTimeOnZonedDate(at, "America/Los_Angeles", "14:30:00").toISOString()).toBe(
      "2026-09-18T21:30:00.000Z",
    );
  });
});
