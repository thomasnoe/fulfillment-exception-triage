import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { createSql } from "../src/db/sql";
import { startWorkers } from "../src/workers/start";
import { calendarDateInTimeZone, wallTimeOnZonedDate } from "../src/workers/warehouse-clock";
import { runCutoffClock } from "../src/workers/sweep";

if (existsSync(".env")) {
  loadEnvFile(".env");
}
if (existsSync(".env.local")) {
  loadEnvFile(".env.local");
}

const AGENCY_A = "a0000000-0000-4000-8000-000000000001";
const PACKED_ORDER = "SEED-PACKED-1";
const ESCALATE_MINUTES = 60;

type PackedRow = {
  id: string;
  exception_id: string;
  severity: string;
  placed_at: Date;
  timezone: string;
  cutoff_time: string;
};

async function main(): Promise<void> {
  const sql = createSql();
  try {
    const packed = await sql.begin(async (tx) => {
      await tx`set local role fulfillment_app`;
      await tx`select set_config('app.current_agency_id', ${AGENCY_A}, true)`;

      const current = await tx<{ id: string; rule_id: string; version: number; config: unknown }[]>`
        select v.id, v.rule_id, v.version, v.config
        from exception_rule_versions v
        join exception_rules r on r.current_version_id = v.id
        where r.agency_id = ${AGENCY_A} and r.key = 'stuck_in_status'
      `;
      const row = current[0];
      if (row === undefined) {
        throw new Error("stuck_in_status version missing; run npm run db:seed");
      }
      const config =
        typeof row.config === "object" && row.config !== null
          ? (row.config as Record<string, unknown>)
          : {};
      if (config.escalateToCriticalMinutesBeforeCutoff === undefined) {
        const nextVersion = row.version + 1;
        const tighter = { ...config, escalateToCriticalMinutesBeforeCutoff: ESCALATE_MINUTES };
        const inserted = await tx<{ id: string }[]>`
          insert into exception_rule_versions (agency_id, rule_id, version, config)
          values (${AGENCY_A}, ${row.rule_id}, ${nextVersion}, ${tx.json(tighter)})
          returning id
        `;
        const newId = inserted[0]?.id;
        if (newId === undefined) {
          throw new Error("failed to append stuck_in_status version");
        }
        await tx`
          update exception_rules
          set current_version_id = ${newId}
          where id = ${row.rule_id}
        `;
      }

      const orders = await tx<PackedRow[]>`
        select
          o.id,
          e.id as exception_id,
          e.severity,
          o.placed_at,
          w.timezone,
          c.cutoff_time::text as cutoff_time
        from orders o
        join warehouses w on w.id = o.warehouse_id
        join exceptions e on e.order_id = o.id
        join exception_rule_versions v on v.id = e.rule_version_id
        join exception_rules r on r.id = v.rule_id
        join carrier_cutoffs c
          on c.warehouse_id = o.warehouse_id
          and c.carrier = o.carrier
          and c.service_level = o.service_level
        where o.external_id = ${PACKED_ORDER}
          and r.key = 'stuck_in_status'
          and e.status in ('open', 'assigned')
        limit 1
      `;
      const order = orders[0];
      if (order === undefined) {
        throw new Error("SEED-PACKED-1 stuck_in_status exception missing");
      }
      return order;
    });

    const { isoDate } = calendarDateInTimeZone(packed.placed_at, packed.timezone);
    const noonish = new Date(`${isoDate}T17:00:00.000Z`);
    const cutoffAt = wallTimeOnZonedDate(noonish, packed.timezone, packed.cutoff_time);
    const morning = new Date(cutoffAt.getTime() - 6 * 60 * 60 * 1000);
    const late = new Date(cutoffAt.getTime() - 20 * 60 * 1000);
    const agedPlacedAt = new Date(morning.getTime() - 5 * 60 * 60 * 1000);

    await sql.begin(async (tx) => {
      await tx`set local role fulfillment_app`;
      await tx`select set_config('app.current_agency_id', ${AGENCY_A}, true)`;
      await tx`update orders set placed_at = ${agedPlacedAt} where id = ${packed.id}`;
    });

    await runCutoffClock(sql, morning);
    const afterMorning = await sql.begin(async (tx) => {
      await tx`set local role fulfillment_app`;
      await tx`select set_config('app.current_agency_id', ${AGENCY_A}, true)`;
      const rows = await tx<{ severity: string }[]>`
        select severity from exceptions where id = ${packed.exception_id}
      `;
      return rows[0]?.severity;
    });
    if (afterMorning !== "medium") {
      throw new Error(`expected medium far from cutoff, got ${afterMorning ?? "missing"}`);
    }

    await runCutoffClock(sql, late);
    const afterLate = await sql.begin(async (tx) => {
      await tx`set local role fulfillment_app`;
      await tx`select set_config('app.current_agency_id', ${AGENCY_A}, true)`;
      const rows = await tx<{ severity: string }[]>`
        select severity from exceptions where id = ${packed.exception_id}
      `;
      return rows[0]?.severity;
    });
    if (afterLate !== "critical") {
      throw new Error(`expected critical near cutoff, got ${afterLate ?? "missing"}`);
    }

    const { stop } = await startWorkers(sql);
    await stop();

    console.log(
      `Phase 5 check passed: SEED-PACKED-1 stuck_in_status ${afterMorning} → ${afterLate} against ${packed.timezone} cutoff ${packed.cutoff_time} with no worker restart.`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
