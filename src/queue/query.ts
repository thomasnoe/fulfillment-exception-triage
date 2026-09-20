import type postgres from "postgres";
import { getAppSql } from "@/db/sql";
import { withTenant } from "@/db/tenant";
import {
  ageAgainstCutoffMs,
  carrierCutoffAt,
  type CutoffLookup,
} from "@/queue/age-against-cutoff";
import type { QueueFilters } from "@/queue/filters";

type ExceptionQueryRow = {
  id: string;
  rule_version_id: string;
  rule_version: number;
  rule_key: string;
  severity: string;
  attributed_to: string;
  status: string;
  assignee_id: string | null;
  assignee_name: string | null;
  opened_at: Date;
  order_external_id: string;
  order_status: string;
  carrier: string | null;
  service_level: string | null;
  warehouse_id: string | null;
  store_id: string;
  store_name: string;
  warehouse_name: string | null;
  warehouse_timezone: string | null;
};

type CutoffQueryRow = {
  warehouse_id: string;
  carrier: string;
  service_level: string;
  day_of_week: number;
  cutoff_time: string;
};

export type QueueRow = {
  id: string;
  ruleVersionId: string;
  ruleVersion: number;
  ruleKey: string;
  severity: string;
  attributedTo: string;
  status: string;
  assigneeId: string | null;
  assigneeName: string | null;
  openedAt: Date;
  orderExternalId: string;
  orderStatus: string;
  storeId: string;
  storeName: string;
  warehouseName: string | null;
  warehouseTimezone: string | null;
  carrierCutoff: Date | null;
  deltaMs: number | null;
};

export type QueueOption = { id: string; label: string };

export type QueuePayload = {
  rows: QueueRow[];
  stores: QueueOption[];
  rules: QueueOption[];
  members: QueueOption[];
};

function sortByAgeAgainstCutoff(rows: QueueRow[]): QueueRow[] {
  return [...rows].sort((a, b) => {
    if (a.deltaMs === null && b.deltaMs === null) {
      return a.openedAt.getTime() - b.openedAt.getTime();
    }
    if (a.deltaMs === null) {
      return 1;
    }
    if (b.deltaMs === null) {
      return -1;
    }
    return b.deltaMs - a.deltaMs;
  });
}

function toLookups(rows: CutoffQueryRow[]): CutoffLookup[] {
  return rows.map((row) => ({
    warehouseId: row.warehouse_id,
    carrier: row.carrier,
    serviceLevel: row.service_level,
    dayOfWeek: row.day_of_week,
    cutoffTime: row.cutoff_time,
  }));
}

async function listExceptions(
  tx: postgres.TransactionSql,
  filters: QueueFilters,
): Promise<ExceptionQueryRow[]> {
  const storeId = filters.store ?? null;
  const ruleKey = filters.rule ?? null;
  const severity = filters.severity ?? null;
  const attributedTo = filters.attributedTo ?? null;
  const assignee = filters.assignee ?? null;
  return tx<ExceptionQueryRow[]>`
    select
      e.id,
      e.rule_version_id,
      v.version as rule_version,
      r.key as rule_key,
      e.severity,
      e.attributed_to,
      e.status,
      e.assignee_id,
      u.name as assignee_name,
      e.opened_at,
      o.external_id as order_external_id,
      o.status as order_status,
      o.carrier,
      o.service_level,
      o.warehouse_id,
      s.id as store_id,
      s.name as store_name,
      w.name as warehouse_name,
      w.timezone as warehouse_timezone
    from exceptions e
    join orders o on o.id = e.order_id
    join stores s on s.id = o.store_id
    join exception_rule_versions v on v.id = e.rule_version_id
    join exception_rules r on r.id = v.rule_id
    left join warehouses w on w.id = o.warehouse_id
    left join users u on u.id = e.assignee_id
    where e.status = ${filters.status}
      and (${storeId}::uuid is null or o.store_id = ${storeId})
      and (${ruleKey}::text is null or r.key = ${ruleKey})
      and (${severity}::text is null or e.severity = ${severity})
      and (${attributedTo}::text is null or e.attributed_to = ${attributedTo})
      and (
        ${assignee}::text is null
        or (${assignee} = 'unassigned' and e.assignee_id is null)
        or e.assignee_id::text = ${assignee}
      )
  `;
}

export async function loadQueue(agencyId: string, filters: QueueFilters): Promise<QueuePayload> {
  const now = new Date();
  return withTenant(getAppSql(), agencyId, async (tx) => {
    const exceptionRows = await listExceptions(tx, filters);
    const cutoffRows = await tx<CutoffQueryRow[]>`
      select warehouse_id, carrier, service_level, day_of_week, cutoff_time::text as cutoff_time
      from carrier_cutoffs
    `;
    const storeRows = await tx<{ id: string; name: string }[]>`
      select id, name from stores order by name
    `;
    const ruleRows = await tx<{ key: string }[]>`
      select key from exception_rules order by key
    `;
    const memberRows = await tx<{ id: string; name: string }[]>`
      select u.id, u.name
      from memberships m
      join users u on u.id = m.user_id
      order by u.name
    `;
    const cutoffs = toLookups(cutoffRows);
    const rows = sortByAgeAgainstCutoff(
      exceptionRows.map((row) => {
        const carrierCutoff = carrierCutoffAt({
          now,
          warehouseId: row.warehouse_id,
          timezone: row.warehouse_timezone,
          carrier: row.carrier,
          serviceLevel: row.service_level,
          cutoffs,
        });
        return {
          id: row.id,
          ruleVersionId: row.rule_version_id,
          ruleVersion: row.rule_version,
          ruleKey: row.rule_key,
          severity: row.severity,
          attributedTo: row.attributed_to,
          status: row.status,
          assigneeId: row.assignee_id,
          assigneeName: row.assignee_name,
          openedAt: row.opened_at,
          orderExternalId: row.order_external_id,
          orderStatus: row.order_status,
          storeId: row.store_id,
          storeName: row.store_name,
          warehouseName: row.warehouse_name,
          warehouseTimezone: row.warehouse_timezone,
          carrierCutoff,
          deltaMs: ageAgainstCutoffMs(now, carrierCutoff),
        };
      }),
    );
    return {
      rows,
      stores: storeRows.map((row) => ({ id: row.id, label: row.name })),
      rules: ruleRows.map((row) => ({ id: row.key, label: row.key })),
      members: memberRows.map((row) => ({ id: row.id, label: row.name })),
    };
  });
}
