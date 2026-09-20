import { z } from "zod";

const severitySchema = z.enum(["critical", "high", "medium", "low"]);
const attributionSchema = z.enum(["merchant", "warehouse", "carrier", "integration"]);
const statusSchema = z.enum(["open", "assigned", "resolved"]);

function first(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }
  if (Array.isArray(value)) {
    return first(value[0]);
  }
  return undefined;
}

const filtersSchema = z.object({
  store: z.uuid().optional(),
  rule: z.string().min(1).optional(),
  severity: severitySchema.optional(),
  attributedTo: attributionSchema.optional(),
  status: statusSchema.default("open"),
  assignee: z.union([z.uuid(), z.literal("unassigned")]).optional(),
});

export type QueueFilters = z.infer<typeof filtersSchema>;

export const SEVERITY_OPTIONS = severitySchema.options;
export const ATTRIBUTION_OPTIONS = attributionSchema.options;
export const STATUS_OPTIONS = statusSchema.options;

const searchValue = z.union([z.string(), z.array(z.string())]);

const rawSearchParams = z.object({
  store: searchValue.optional(),
  rule: searchValue.optional(),
  severity: searchValue.optional(),
  attributedTo: searchValue.optional(),
  status: searchValue.optional(),
  assignee: searchValue.optional(),
});

/**
 * Shareable queue views live in the URL. Invalid params fall back to open so a
 * bad link does not crash the demo.
 *
 * TODO(thomas): `sort` searchParam (age against cutoff is the default in JS today).
 */
export function parseQueueFilters(searchParams: unknown): QueueFilters {
  const raw = rawSearchParams.catch({}).parse(searchParams);
  const parsed = filtersSchema.safeParse({
    store: first(raw.store),
    rule: first(raw.rule),
    severity: first(raw.severity),
    attributedTo: first(raw.attributedTo),
    status: first(raw.status),
    assignee: first(raw.assignee),
  });
  if (!parsed.success) {
    return { status: "open" };
  }
  return parsed.data;
}
