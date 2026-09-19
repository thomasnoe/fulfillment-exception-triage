import { z } from "zod";

const orderStatuses = [
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

const orderLineSchema = z.object({
  sku_id: z.uuid(),
  qty_ordered: z.number().int().positive(),
  qty_allocated: z.number().int().nonnegative().optional(),
  qty_picked: z.number().int().nonnegative().optional(),
  qty_shipped: z.number().int().nonnegative().optional(),
});

export const webhookOrderPayloadSchema = z.object({
  store_id: z.uuid(),
  external_id: z.string().min(1),
  status: z.enum(orderStatuses),
  placed_at: z.iso.datetime(),
  warehouse_id: z.uuid().optional(),
  carrier: z.string().min(1).optional(),
  service_level: z.string().min(1).optional(),
  lines: z.array(orderLineSchema).default([]),
});

export type WebhookOrderPayload = z.infer<typeof webhookOrderPayloadSchema>;

export function parseWebhookOrderPayload(rawBody: string): WebhookOrderPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    throw new Error("WEBHOOK_JSON_INVALID");
  }
  return webhookOrderPayloadSchema.parse(parsed);
}
