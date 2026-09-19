import { z } from "zod";
import { RULE_KEYS, type RuleKey } from "./types";

const orderStatusSchema = z.enum([
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
]);

export const missedCarrierCutoffConfigSchema = z.object({
  requiredStatusByCutoff: orderStatusSchema,
  skipOnHoliday: z.boolean().optional(),
});

export const allocationFailureConfigSchema = z.object({
  syncLagMeansIntegration: z.boolean(),
  countVarianceMeansWarehouse: z.boolean(),
  integrationMaxShortfall: z.number().int().positive().optional(),
});

export const addressValidationConfigSchema = z.object({
  fireWhenAddressInvalid: z.boolean().optional(),
});

export const shortPickConfigSchema = z.object({
  comparePickedToAllocated: z.boolean().optional(),
});

export const stuckInStatusConfigSchema = z.object({
  thresholdMinutes: z.record(z.string(), z.number().int().nonnegative()),
  escalateToCriticalMinutesBeforeCutoff: z.number().int().nonnegative().optional(),
  attributionByStatus: z
    .record(z.string(), z.enum(["merchant", "warehouse", "carrier", "integration"]))
    .optional(),
  terminalStatuses: z.array(orderStatusSchema).optional(),
});

export const returnPendingConfigSchema = z.object({
  pendingHours: z.number().positive(),
});

export const ruleConfigByKey = {
  missed_carrier_cutoff: missedCarrierCutoffConfigSchema,
  allocation_failure: allocationFailureConfigSchema,
  address_validation_failure: addressValidationConfigSchema,
  short_pick: shortPickConfigSchema,
  stuck_in_status: stuckInStatusConfigSchema,
  return_pending_disposition: returnPendingConfigSchema,
} as const;

export function parseRuleConfig<K extends RuleKey>(key: K, config: unknown): z.infer<(typeof ruleConfigByKey)[K]> {
  return ruleConfigByKey[key].parse(config);
}

export function isRuleKey(value: string): value is RuleKey {
  return (RULE_KEYS as readonly string[]).includes(value);
}
