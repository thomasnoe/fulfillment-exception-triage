import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { createSql } from "../src/db/sql";
import { evaluateRule } from "../src/rules/evaluate";
import type { OrderState } from "../src/rules/types";

if (existsSync(".env")) {
  loadEnvFile(".env");
}
if (existsSync(".env.local")) {
  loadEnvFile(".env.local");
}

const AGENCY_A = "a0000000-0000-4000-8000-000000000001";
const RULE_KEY = "stuck_in_status";

const state: OrderState = {
  status: "ALLOCATED",
  now: new Date("2026-09-19T18:00:00.000Z"),
  minutesInStatus: 180,
  carrierCutoffAt: new Date("2026-09-19T22:00:00.000Z"),
  isHoliday: false,
  lines: [{ qtyOrdered: 2, qtyAllocated: 2, qtyPicked: 0, qtyShipped: 0 }],
  lastInventorySyncedAt: new Date("2026-09-19T18:00:00.000Z"),
  syncIntervalMinutes: 15,
  physicalCountDiffersFromSystem: false,
  addressValid: true,
  returnReceivedAt: null,
  returnDispositionedAt: null,
};

async function main(): Promise<void> {
  const sql = createSql();
  try {
    await sql.begin(async (tx) => {
      await tx`set local role fulfillment_app`;
      await tx`select set_config('app.current_agency_id', ${AGENCY_A}, true)`;

      const current = await tx<{ id: string; rule_id: string; config: unknown }[]>`
        select v.id, v.rule_id, v.config
        from exception_rule_versions v
        join exception_rules r on r.current_version_id = v.id
        where r.agency_id = ${AGENCY_A} and r.key = ${RULE_KEY}
      `;
      const row = current[0];
      if (row === undefined) {
        throw new Error("stuck_in_status rule version missing; run npm run db:seed");
      }

      const before = evaluateRule(RULE_KEY, state, row.config);
      if (before !== null) {
        throw new Error("expected no fire with seeded ALLOCATED threshold of 240 minutes");
      }

      const tighter = {
        ...(typeof row.config === "object" && row.config !== null ? row.config : {}),
        thresholdMinutes: { ALLOCATED: 60, PICKING: 180, PACKED: 120, MANIFESTED: 90 },
      };
      const newVersionId = "f0000000-0000-4000-8000-000000009901";
      await tx`
        insert into exception_rule_versions (id, agency_id, rule_id, version, config)
        values (${newVersionId}, ${AGENCY_A}, ${row.rule_id}, 2, ${tx.json(tighter)})
      `;
      await tx`
        update exception_rules
        set current_version_id = ${newVersionId}
        where id = ${row.rule_id}
      `;

      const updated = await tx<{ config: unknown }[]>`
        select v.config
        from exception_rule_versions v
        join exception_rules r on r.current_version_id = v.id
        where r.id = ${row.rule_id}
      `;
      const afterConfig = updated[0]?.config;
      const after = evaluateRule(RULE_KEY, state, afterConfig);
      if (after === null || after.key !== "stuck_in_status") {
        throw new Error("expected fire after loading tighter threshold from DB with no code change");
      }

      throw new Error("RULES_CONFIG_CHECK_OK");
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== "RULES_CONFIG_CHECK_OK") {
      throw error;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  console.log("Phase 4 check passed: Vitest-backed engine; DB config change altered stuck_in_status with no code edit.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
