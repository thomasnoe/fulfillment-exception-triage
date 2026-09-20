import { describe, expect, it } from "vitest";
import {
  ageAgainstCutoffMs,
  carrierCutoffAt,
  formatAgeAgainstCutoff,
  type CutoffLookup,
} from "./age-against-cutoff";
import { parseQueueFilters } from "./filters";

const fridayAfternoonUtc = new Date("2026-09-18T20:30:00.000Z");

const cutoffs: CutoffLookup[] = [
  {
    warehouseId: "ewr",
    carrier: "UPS",
    serviceLevel: "ground",
    dayOfWeek: 5,
    cutoffTime: "16:00:00",
  },
  {
    warehouseId: "lax",
    carrier: "UPS",
    serviceLevel: "ground",
    dayOfWeek: 5,
    cutoffTime: "14:30:00",
  },
];

describe("carrierCutoffAt", () => {
  it("uses the warehouse timezone, not a global cutoff hour", () => {
    const ewr = carrierCutoffAt({
      now: fridayAfternoonUtc,
      warehouseId: "ewr",
      timezone: "America/New_York",
      carrier: "UPS",
      serviceLevel: "ground",
      cutoffs,
    });
    const lax = carrierCutoffAt({
      now: fridayAfternoonUtc,
      warehouseId: "lax",
      timezone: "America/Los_Angeles",
      carrier: "UPS",
      serviceLevel: "ground",
      cutoffs,
    });
    expect(ewr?.toISOString()).toBe("2026-09-18T20:00:00.000Z");
    expect(lax?.toISOString()).toBe("2026-09-18T21:30:00.000Z");
    expect(ageAgainstCutoffMs(fridayAfternoonUtc, ewr ?? null)).toBe(30 * 60 * 1000);
    expect(ageAgainstCutoffMs(fridayAfternoonUtc, lax ?? null)).toBe(-60 * 60 * 1000);
    expect(formatAgeAgainstCutoff(30 * 60 * 1000, "America/New_York")).toContain("America/New_York");
  });

  it("returns null when this warehouse/carrier/service/day has no cutoff row", () => {
    expect(
      carrierCutoffAt({
        now: fridayAfternoonUtc,
        warehouseId: "ewr",
        timezone: "America/New_York",
        carrier: "USPS",
        serviceLevel: "ground",
        cutoffs,
      }),
    ).toBeNull();
  });
});

describe("parseQueueFilters", () => {
  it("defaults to open so the seeded queue is the shareable view", () => {
    expect(parseQueueFilters({})).toEqual({ status: "open" });
  });

  it("reads store, rule, severity, attribution, status, assignee from searchParams", () => {
    expect(
      parseQueueFilters({
        store: "d0000000-0000-4000-8000-000000000001",
        rule: "short_pick",
        severity: "high",
        attributedTo: "warehouse",
        status: "assigned",
        assignee: "unassigned",
      }),
    ).toEqual({
      store: "d0000000-0000-4000-8000-000000000001",
      rule: "short_pick",
      severity: "high",
      attributedTo: "warehouse",
      status: "assigned",
      assignee: "unassigned",
    });
  });
});
