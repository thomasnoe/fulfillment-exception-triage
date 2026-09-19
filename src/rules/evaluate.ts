import { parseRuleConfig } from "./config";
import {
  TERMINAL_STATUSES,
  type Attribution,
  type ExceptionDraft,
  type OrderState,
  type RuleKey,
  type RuleVersionInput,
  type Severity,
} from "./types";

const STATUS_SEQUENCE = [
  "RECEIVED",
  "VALIDATED",
  "ON_HOLD",
  "ALLOCATED",
  "BACKORDERED",
  "RELEASED",
  "PICKING",
  "PICKED",
  "PACKED",
  "MANIFESTED",
  "STAGED",
  "SHIPPED",
  "PARTIALLY_SHIPPED",
  "IN_TRANSIT",
  "DELIVERED",
  "CANCELLED",
] as const;

function hasReached(current: OrderState["status"], required: OrderState["status"]): boolean {
  return STATUS_SEQUENCE.indexOf(current) >= STATUS_SEQUENCE.indexOf(required);
}

function shortfall(state: OrderState): number {
  return state.lines.reduce((sum, line) => sum + Math.max(0, line.qtyOrdered - line.qtyAllocated), 0);
}

function missedCarrierCutoff(state: OrderState, config: unknown): ExceptionDraft | null {
  const parsed = parseRuleConfig("missed_carrier_cutoff", config);
  if (parsed.skipOnHoliday === true && state.isHoliday) {
    return null;
  }
  if (state.carrierCutoffAt === null || state.now <= state.carrierCutoffAt) {
    return null;
  }
  if (hasReached(state.status, parsed.requiredStatusByCutoff)) {
    return null;
  }
  return { key: "missed_carrier_cutoff", severity: "critical", attributedTo: "warehouse" };
}

function allocationFailure(state: OrderState, config: unknown): ExceptionDraft | null {
  const parsed = parseRuleConfig("allocation_failure", config);
  const unitsShort = shortfall(state);
  if (unitsShort <= 0) {
    return null;
  }
  let attributedTo: Attribution = "merchant";
  const syncAgeMs =
    state.lastInventorySyncedAt === null
      ? Number.POSITIVE_INFINITY
      : state.now.getTime() - state.lastInventorySyncedAt.getTime();
  const lagMs = state.syncIntervalMinutes * 60 * 1000;
  const syncLagging = syncAgeMs > lagMs;
  const withinDelta =
    parsed.integrationMaxShortfall === undefined || unitsShort <= parsed.integrationMaxShortfall;
  if (parsed.syncLagMeansIntegration && syncLagging && withinDelta) {
    attributedTo = "integration";
  } else if (parsed.countVarianceMeansWarehouse && state.physicalCountDiffersFromSystem) {
    attributedTo = "warehouse";
  }
  return { key: "allocation_failure", severity: "critical", attributedTo };
}

function addressValidationFailure(state: OrderState, config: unknown): ExceptionDraft | null {
  const parsed = parseRuleConfig("address_validation_failure", config);
  if (parsed.fireWhenAddressInvalid !== true || state.addressValid) {
    return null;
  }
  if (hasReached(state.status, "SHIPPED")) {
    return null;
  }
  return { key: "address_validation_failure", severity: "high", attributedTo: "merchant" };
}

function shortPick(state: OrderState, config: unknown): ExceptionDraft | null {
  const parsed = parseRuleConfig("short_pick", config);
  if (parsed.comparePickedToAllocated !== true) {
    return null;
  }
  const underPicked = state.lines.some((line) => line.qtyPicked < line.qtyAllocated);
  if (!underPicked) {
    return null;
  }
  return { key: "short_pick", severity: "high", attributedTo: "warehouse" };
}

function stuckInStatus(state: OrderState, config: unknown): ExceptionDraft | null {
  const parsed = parseRuleConfig("stuck_in_status", config);
  const terminals = parsed.terminalStatuses ?? TERMINAL_STATUSES;
  if (terminals.includes(state.status)) {
    return null;
  }
  const threshold = parsed.thresholdMinutes[state.status];
  if (threshold === undefined || state.minutesInStatus < threshold) {
    return null;
  }
  const attributedTo = parsed.attributionByStatus?.[state.status] ?? "warehouse";
  let severity: Severity = "medium";
  if (
    state.carrierCutoffAt !== null &&
    parsed.escalateToCriticalMinutesBeforeCutoff !== undefined
  ) {
    const minutesToCutoff = (state.carrierCutoffAt.getTime() - state.now.getTime()) / 60000;
    if (minutesToCutoff <= parsed.escalateToCriticalMinutesBeforeCutoff) {
      severity = "critical";
    }
  }
  return { key: "stuck_in_status", severity, attributedTo };
}

function returnPendingDisposition(state: OrderState, config: unknown): ExceptionDraft | null {
  const parsed = parseRuleConfig("return_pending_disposition", config);
  if (state.returnReceivedAt === null || state.returnDispositionedAt !== null) {
    return null;
  }
  const pendingMs = parsed.pendingHours * 60 * 60 * 1000;
  if (state.now.getTime() - state.returnReceivedAt.getTime() < pendingMs) {
    return null;
  }
  return { key: "return_pending_disposition", severity: "low", attributedTo: "warehouse" };
}

const evaluators: Record<RuleKey, (state: OrderState, config: unknown) => ExceptionDraft | null> = {
  missed_carrier_cutoff: missedCarrierCutoff,
  allocation_failure: allocationFailure,
  address_validation_failure: addressValidationFailure,
  short_pick: shortPick,
  stuck_in_status: stuckInStatus,
  return_pending_disposition: returnPendingDisposition,
};

export function evaluateRule(key: RuleKey, state: OrderState, config: unknown): ExceptionDraft | null {
  return evaluators[key](state, config);
}

export function evaluateRuleVersions(
  state: OrderState,
  versions: RuleVersionInput[],
): Array<ExceptionDraft & { ruleVersionId: string }> {
  const fired: Array<ExceptionDraft & { ruleVersionId: string }> = [];
  for (const version of versions) {
    if (!version.enabled) {
      continue;
    }
    const draft = evaluateRule(version.key, state, version.config);
    if (draft !== null) {
      fired.push({ ...draft, ruleVersionId: version.ruleVersionId });
    }
  }
  return fired;
}
