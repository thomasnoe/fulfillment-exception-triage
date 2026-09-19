import { z } from "zod";
import type postgres from "postgres";
import { isRuleKey } from "../rules/config";
import { evaluateRuleVersions } from "../rules/evaluate";
import {
  TERMINAL_STATUSES,
  type Attribution,
  type OrderState,
  type OrderStatus,
  type RuleKey,
  type RuleVersionInput,
  type Severity,
} from "../rules/types";
import { calendarDateInTimeZone, dayOfWeekInTimeZone, wallTimeOnZonedDate } from "./warehouse-clock";

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

export const jobClockSchema = z.object({
  nowIso: z.string().optional(),
});

export type SweepMode = "aging" | "cutoff";

export type SweepStats = {
  agencies: number;
  orders: number;
  inserted: number;
  updated: number;
};

type AgencyRow = { id: string };

type RuleRow = {
  rule_version_id: string;
  key: string;
  enabled: boolean;
  config: unknown;
};

type OrderRow = {
  id: string;
  status: string;
  placed_at: Date;
  carrier: string | null;
  service_level: string | null;
  warehouse_id: string | null;
  timezone: string | null;
  sync_interval_minutes: number;
  last_synced_at: Date | null;
};

type LineRow = {
  qty_ordered: number;
  qty_allocated: number;
  qty_picked: number;
  qty_shipped: number;
};

type ReturnRow = {
  received_at: Date;
  dispositioned_at: Date | null;
};

type CutoffRow = { cutoff_time: string };
type HolidayRow = { n: number };
type InventoryVarRow = { n: number };

type OpenExceptionRow = {
  id: string;
  severity: string;
  attributed_to: string;
  rule_version_id: string;
  key: string;
};

function asStatus(value: string): OrderStatus {
  return orderStatusSchema.parse(value);
}

function minutesInStatus(placedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - placedAt.getTime()) / 60000));
}

async function withTenant<T>(
  sql: postgres.Sql,
  agencyId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const result: unknown = await sql.begin(async (tx) => {
    await tx`set local role fulfillment_app`;
    await tx`select set_config('app.current_agency_id', ${agencyId}, true)`;
    return fn(tx);
  });
  return result as T;
}

async function loadRuleVersions(tx: postgres.TransactionSql): Promise<RuleVersionInput[]> {
  const rows = await tx<RuleRow[]>`
    select v.id as rule_version_id, r.key, r.enabled, v.config
    from exception_rules r
    join exception_rule_versions v on v.id = r.current_version_id
  `;
  const versions: RuleVersionInput[] = [];
  for (const row of rows) {
    if (!isRuleKey(row.key)) {
      continue;
    }
    versions.push({
      ruleVersionId: row.rule_version_id,
      key: row.key,
      enabled: row.enabled,
      config: row.config,
    });
  }
  return versions;
}

async function resolveCarrierCutoffAt(
  tx: postgres.TransactionSql,
  order: OrderRow,
  now: Date,
): Promise<{ carrierCutoffAt: Date | null; isHoliday: boolean }> {
  if (order.warehouse_id === null || order.timezone === null) {
    return { carrierCutoffAt: null, isHoliday: false };
  }
  const { isoDate } = calendarDateInTimeZone(now, order.timezone);
  const holidays = await tx<HolidayRow[]>`
    select count(*)::int as n
    from holidays
    where warehouse_id = ${order.warehouse_id} and observed_on = ${isoDate}
  `;
  const isHoliday = (holidays[0]?.n ?? 0) > 0;
  const carrier = order.carrier;
  const service = order.service_level;
  if (carrier === null || service === null) {
    return { carrierCutoffAt: null, isHoliday };
  }
  const dow = dayOfWeekInTimeZone(now, order.timezone);
  const cutoffs = await tx<CutoffRow[]>`
    select cutoff_time::text as cutoff_time
    from carrier_cutoffs
    where warehouse_id = ${order.warehouse_id}
      and carrier = ${carrier}
      and service_level = ${service}
      and day_of_week = ${dow}
    limit 1
  `;
  const cutoffTime = cutoffs[0]?.cutoff_time;
  if (cutoffTime === undefined) {
    return { carrierCutoffAt: null, isHoliday };
  }
  return {
    carrierCutoffAt: wallTimeOnZonedDate(now, order.timezone, cutoffTime),
    isHoliday,
  };
}

async function buildOrderState(
  tx: postgres.TransactionSql,
  order: OrderRow,
  now: Date,
): Promise<OrderState> {
  const lines = await tx<LineRow[]>`
    select qty_ordered, qty_allocated, qty_picked, qty_shipped
    from order_lines
    where order_id = ${order.id}
  `;
  const returns = await tx<ReturnRow[]>`
    select received_at, dispositioned_at
    from returns
    where order_id = ${order.id}
    order by received_at desc
    limit 1
  `;
  const ret = returns[0];
  const variance = await tx<InventoryVarRow[]>`
    select count(*)::int as n
    from inventory i
    join order_lines l on l.sku_id = i.sku_id
    where l.order_id = ${order.id}
      and i.warehouse_id is not distinct from ${order.warehouse_id}
      and i.pending_disposition > 0
  `;
  const { carrierCutoffAt, isHoliday } = await resolveCarrierCutoffAt(tx, order, now);
  return {
    status: asStatus(order.status),
    now,
    minutesInStatus: minutesInStatus(order.placed_at, now),
    carrierCutoffAt,
    isHoliday,
    lines: lines.map((line) => ({
      qtyOrdered: line.qty_ordered,
      qtyAllocated: line.qty_allocated,
      qtyPicked: line.qty_picked,
      qtyShipped: line.qty_shipped,
    })),
    lastInventorySyncedAt: order.last_synced_at,
    syncIntervalMinutes: order.sync_interval_minutes,
    physicalCountDiffersFromSystem: (variance[0]?.n ?? 0) > 0,
    addressValid: true,
    returnReceivedAt: ret?.received_at ?? null,
    returnDispositionedAt: ret?.dispositioned_at ?? null,
  };
}

async function applyDrafts(
  tx: postgres.TransactionSql,
  agencyId: string,
  orderId: string,
  drafts: Array<{ key: RuleKey; severity: Severity; attributedTo: Attribution; ruleVersionId: string }>,
  reason: string,
): Promise<{ inserted: number; updated: number }> {
  const open = await tx<OpenExceptionRow[]>`
    select e.id, e.severity, e.attributed_to, e.rule_version_id, r.key
    from exceptions e
    join exception_rule_versions v on v.id = e.rule_version_id
    join exception_rules r on r.id = v.rule_id
    where e.order_id = ${orderId} and e.status in ('open', 'assigned')
  `;
  let inserted = 0;
  let updated = 0;
  for (const draft of drafts) {
    const existing = open.find((row) => row.key === draft.key);
    if (existing === undefined) {
      const created = await tx<{ id: string }[]>`
        insert into exceptions (
          agency_id, order_id, rule_version_id, severity, attributed_to, status
        ) values (
          ${agencyId}, ${orderId}, ${draft.ruleVersionId}, ${draft.severity}, ${draft.attributedTo}, 'open'
        )
        returning id
      `;
      const exceptionId = created[0]?.id;
      if (exceptionId === undefined) {
        throw new Error("exception insert missing id");
      }
      await tx`
        insert into audit_log (
          agency_id, entity_type, entity_id, action, after, reason
        ) values (
          ${agencyId},
          'exceptions',
          ${exceptionId},
          'open',
          ${tx.json({
            orderId,
            ruleVersionId: draft.ruleVersionId,
            severity: draft.severity,
            attributedTo: draft.attributedTo,
            key: draft.key,
          })},
          ${reason}
        )
      `;
      inserted += 1;
      continue;
    }
    const sameSeverity = existing.severity === draft.severity;
    const sameVersion = existing.rule_version_id === draft.ruleVersionId;
    const sameAttribution = existing.attributed_to === draft.attributedTo;
    if (sameSeverity && sameVersion && sameAttribution) {
      continue;
    }
    await tx`
      update exceptions
      set
        severity = ${draft.severity},
        attributed_to = ${draft.attributedTo},
        rule_version_id = ${draft.ruleVersionId}
      where id = ${existing.id}
    `;
    await tx`
      insert into audit_log (
        agency_id, entity_type, entity_id, action, before, after, reason
      ) values (
        ${agencyId},
        'exceptions',
        ${existing.id},
        'escalate',
        ${tx.json({
          severity: existing.severity,
          attributedTo: existing.attributed_to,
          ruleVersionId: existing.rule_version_id,
        })},
        ${tx.json({
          severity: draft.severity,
          attributedTo: draft.attributedTo,
          ruleVersionId: draft.ruleVersionId,
        })},
        ${reason}
      )
    `;
    updated += 1;
  }
  return { inserted, updated };
}

async function sweepAgency(
  sql: postgres.Sql,
  agencyId: string,
  now: Date,
  mode: SweepMode,
): Promise<{ orders: number; inserted: number; updated: number }> {
  return withTenant(sql, agencyId, async (tx) => {
    const versions = await loadRuleVersions(tx);
    const filtered =
      mode === "cutoff" ? versions.filter((version) => version.key === "stuck_in_status") : versions;
    const terminal = TERMINAL_STATUSES;
    const orders = await tx<OrderRow[]>`
      select
        o.id,
        o.status,
        o.placed_at,
        o.carrier,
        o.service_level,
        o.warehouse_id,
        w.timezone,
        s.sync_interval_minutes,
        (
          select i.synced_at
          from inventory_syncs i
          where i.store_id = o.store_id
          order by i.synced_at desc
          limit 1
        ) as last_synced_at
      from orders o
      join stores s on s.id = o.store_id
      left join warehouses w on w.id = o.warehouse_id
      where o.status not in ${tx(terminal)}
    `;
    let inserted = 0;
    let updated = 0;
    const reason = mode === "cutoff" ? "cutoff clock" : "aging sweep";
    for (const order of orders) {
      const state = await buildOrderState(tx, order, now);
      const drafts = evaluateRuleVersions(state, filtered);
      const applied = await applyDrafts(tx, agencyId, order.id, drafts, reason);
      inserted += applied.inserted;
      updated += applied.updated;
    }
    return { orders: orders.length, inserted, updated };
  });
}

export function nowFromJobData(data: unknown, fallback = new Date()): Date {
  const parsed = jobClockSchema.parse(data ?? {});
  if (parsed.nowIso === undefined) {
    return fallback;
  }
  const now = new Date(parsed.nowIso);
  if (Number.isNaN(now.getTime())) {
    throw new Error("invalid nowIso on worker job");
  }
  return now;
}

export async function runSweep(
  sql: postgres.Sql,
  mode: SweepMode,
  now: Date,
): Promise<SweepStats> {
  const agencies = await sql<AgencyRow[]>`select id from agencies order by name`;
  const stats: SweepStats = { agencies: agencies.length, orders: 0, inserted: 0, updated: 0 };
  for (const agency of agencies) {
    const result = await sweepAgency(sql, agency.id, now, mode);
    stats.orders += result.orders;
    stats.inserted += result.inserted;
    stats.updated += result.updated;
  }
  return stats;
}

export async function runAgingSweep(sql: postgres.Sql, now = new Date()): Promise<SweepStats> {
  return runSweep(sql, "aging", now);
}

export async function runCutoffClock(sql: postgres.Sql, now = new Date()): Promise<SweepStats> {
  return runSweep(sql, "cutoff", now);
}
