import { describe, expect, it } from "vitest";
import { evaluateRule } from "./evaluate";
import type { OrderState } from "./types";

const now = new Date("2026-09-19T18:00:00.000Z");

function baseState(overrides: Partial<OrderState> = {}): OrderState {
  return {
    status: "PACKED",
    now,
    minutesInStatus: 30,
    carrierCutoffAt: new Date("2026-09-19T19:00:00.000Z"),
    isHoliday: false,
    lines: [{ qtyOrdered: 4, qtyAllocated: 4, qtyPicked: 4, qtyShipped: 0 }],
    lastInventorySyncedAt: now,
    syncIntervalMinutes: 15,
    physicalCountDiffersFromSystem: false,
    addressValid: true,
    returnReceivedAt: null,
    returnDispositionedAt: null,
    ...overrides,
  };
}

describe("missed_carrier_cutoff", () => {
  const config = { requiredStatusByCutoff: "STAGED" as const, skipOnHoliday: true };

  it("fires when cutoff has passed and the order is not yet STAGED", () => {
    const result = evaluateRule("missed_carrier_cutoff", baseState({
      status: "PACKED",
      carrierCutoffAt: new Date("2026-09-19T17:00:00.000Z"),
    }), config);
    expect(result).toEqual({
      key: "missed_carrier_cutoff",
      severity: "critical",
      attributedTo: "warehouse",
    });
  });

  it("does not fire when the order is already STAGED", () => {
    const result = evaluateRule("missed_carrier_cutoff", baseState({
      status: "STAGED",
      carrierCutoffAt: new Date("2026-09-19T17:00:00.000Z"),
    }), config);
    expect(result).toBeNull();
  });
});

describe("allocation_failure", () => {
  const config = {
    syncLagMeansIntegration: true,
    countVarianceMeansWarehouse: true,
    integrationMaxShortfall: 10,
  };

  it("attributes integration when inventory sync is stale and the shortfall is within the configured delta", () => {
    const result = evaluateRule("allocation_failure", baseState({
      status: "BACKORDERED",
      lastInventorySyncedAt: new Date("2026-09-19T16:00:00.000Z"),
      syncIntervalMinutes: 15,
      lines: [{ qtyOrdered: 6, qtyAllocated: 2, qtyPicked: 0, qtyShipped: 0 }],
      physicalCountDiffersFromSystem: false,
    }), config);
    expect(result).toEqual({
      key: "allocation_failure",
      severity: "critical",
      attributedTo: "integration",
    });
  });

  it("attributes warehouse when sync is current and physical count differs from system", () => {
    const result = evaluateRule("allocation_failure", baseState({
      status: "BACKORDERED",
      lastInventorySyncedAt: now,
      syncIntervalMinutes: 15,
      physicalCountDiffersFromSystem: true,
      lines: [{ qtyOrdered: 6, qtyAllocated: 2, qtyPicked: 0, qtyShipped: 0 }],
    }), config);
    expect(result).toEqual({
      key: "allocation_failure",
      severity: "critical",
      attributedTo: "warehouse",
    });
  });

  it("attributes merchant when sync is current, counts match, and demand still exceeds ATP", () => {
    const result = evaluateRule("allocation_failure", baseState({
      status: "BACKORDERED",
      lastInventorySyncedAt: now,
      syncIntervalMinutes: 15,
      physicalCountDiffersFromSystem: false,
      lines: [{ qtyOrdered: 6, qtyAllocated: 2, qtyPicked: 0, qtyShipped: 0 }],
    }), config);
    expect(result).toEqual({
      key: "allocation_failure",
      severity: "critical",
      attributedTo: "merchant",
    });
  });

  it("does not fire when allocated quantity covers ordered quantity", () => {
    const result = evaluateRule("allocation_failure", baseState({
      status: "ALLOCATED",
      lines: [{ qtyOrdered: 4, qtyAllocated: 4, qtyPicked: 0, qtyShipped: 0 }],
    }), config);
    expect(result).toBeNull();
  });
});

describe("address_validation_failure", () => {
  const config = { fireWhenAddressInvalid: true };

  it("fires when the address is invalid before label generation", () => {
    const result = evaluateRule("address_validation_failure", baseState({
      status: "ON_HOLD",
      addressValid: false,
    }), config);
    expect(result).toEqual({
      key: "address_validation_failure",
      severity: "high",
      attributedTo: "merchant",
    });
  });

  it("does not fire when the address is valid", () => {
    const result = evaluateRule("address_validation_failure", baseState({
      status: "ON_HOLD",
      addressValid: true,
    }), config);
    expect(result).toBeNull();
  });
});

describe("short_pick", () => {
  const config = { comparePickedToAllocated: true };

  it("fires when picked quantity is below allocated quantity", () => {
    const result = evaluateRule("short_pick", baseState({
      status: "PICKING",
      lines: [{ qtyOrdered: 4, qtyAllocated: 4, qtyPicked: 2, qtyShipped: 0 }],
    }), config);
    expect(result).toEqual({
      key: "short_pick",
      severity: "high",
      attributedTo: "warehouse",
    });
  });

  it("does not fire when picked quantity meets allocated quantity", () => {
    const result = evaluateRule("short_pick", baseState({
      status: "PICKED",
      lines: [{ qtyOrdered: 4, qtyAllocated: 4, qtyPicked: 4, qtyShipped: 0 }],
    }), config);
    expect(result).toBeNull();
  });
});

describe("stuck_in_status", () => {
  const config = {
    thresholdMinutes: { PACKED: 120, ALLOCATED: 240 },
    escalateToCriticalMinutesBeforeCutoff: 30,
    attributionByStatus: { PACKED: "warehouse" as const, ALLOCATED: "warehouse" as const },
    terminalStatuses: ["SHIPPED" as const, "DELIVERED" as const, "CANCELLED" as const],
  };

  it("fires medium when PACKED is past the aging threshold and cutoff is not imminent", () => {
    const result = evaluateRule("stuck_in_status", baseState({
      status: "PACKED",
      minutesInStatus: 180,
      carrierCutoffAt: new Date("2026-09-19T20:00:00.000Z"),
    }), config);
    expect(result).toEqual({
      key: "stuck_in_status",
      severity: "medium",
      attributedTo: "warehouse",
    });
  });

  it("escalates to critical when the same PACKED order is within the configured minutes of cutoff", () => {
    const result = evaluateRule("stuck_in_status", baseState({
      status: "PACKED",
      minutesInStatus: 180,
      carrierCutoffAt: new Date("2026-09-19T18:20:00.000Z"),
    }), config);
    expect(result).toEqual({
      key: "stuck_in_status",
      severity: "critical",
      attributedTo: "warehouse",
    });
  });

  it("does not fire for terminal statuses", () => {
    const result = evaluateRule("stuck_in_status", baseState({
      status: "SHIPPED",
      minutesInStatus: 999,
    }), config);
    expect(result).toBeNull();
  });
});

describe("return_pending_disposition", () => {
  const config = { pendingHours: 72 };

  it("fires when a return has no disposition past the configured pending hours", () => {
    const result = evaluateRule("return_pending_disposition", baseState({
      status: "DELIVERED",
      returnReceivedAt: new Date("2026-09-08T18:00:00.000Z"),
      returnDispositionedAt: null,
    }), config);
    expect(result).toEqual({
      key: "return_pending_disposition",
      severity: "low",
      attributedTo: "warehouse",
    });
  });

  it("does not fire when the return was dispositioned", () => {
    const result = evaluateRule("return_pending_disposition", baseState({
      status: "DELIVERED",
      returnReceivedAt: new Date("2026-09-08T18:00:00.000Z"),
      returnDispositionedAt: new Date("2026-09-09T18:00:00.000Z"),
    }), config);
    expect(result).toBeNull();
  });
});

describe("config drives behavior", () => {
  it("stops firing short_pick when comparePickedToAllocated is false in config", () => {
    const state = baseState({
      status: "PICKING",
      lines: [{ qtyOrdered: 4, qtyAllocated: 4, qtyPicked: 1, qtyShipped: 0 }],
    });
    expect(evaluateRule("short_pick", state, { comparePickedToAllocated: true })).not.toBeNull();
    expect(evaluateRule("short_pick", state, { comparePickedToAllocated: false })).toBeNull();
  });
});
