export const RULE_KEYS = [
  "missed_carrier_cutoff",
  "allocation_failure",
  "address_validation_failure",
  "short_pick",
  "stuck_in_status",
  "return_pending_disposition",
] as const;

export type RuleKey = (typeof RULE_KEYS)[number];

export type Severity = "critical" | "high" | "medium" | "low";
export type Attribution = "merchant" | "warehouse" | "carrier" | "integration";

export type OrderStatus =
  | "RECEIVED"
  | "VALIDATED"
  | "ON_HOLD"
  | "ALLOCATED"
  | "BACKORDERED"
  | "RELEASED"
  | "PICKING"
  | "PICKED"
  | "PACKED"
  | "MANIFESTED"
  | "STAGED"
  | "SHIPPED"
  | "PARTIALLY_SHIPPED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "CANCELLED";

export const TERMINAL_STATUSES: OrderStatus[] = ["SHIPPED", "DELIVERED", "CANCELLED"];

export type OrderLineState = {
  qtyOrdered: number;
  qtyAllocated: number;
  qtyPicked: number;
  qtyShipped: number;
};

export type OrderState = {
  status: OrderStatus;
  now: Date;
  minutesInStatus: number;
  carrierCutoffAt: Date | null;
  isHoliday: boolean;
  lines: OrderLineState[];
  lastInventorySyncedAt: Date | null;
  syncIntervalMinutes: number;
  physicalCountDiffersFromSystem: boolean;
  addressValid: boolean;
  returnReceivedAt: Date | null;
  returnDispositionedAt: Date | null;
};

export type ExceptionDraft = {
  key: RuleKey;
  severity: Severity;
  attributedTo: Attribution;
};

export type RuleVersionInput = {
  ruleVersionId: string;
  key: RuleKey;
  enabled: boolean;
  config: unknown;
};
