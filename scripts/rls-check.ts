import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import postgres from "postgres";

if (existsSync(".env")) {
  loadEnvFile(".env");
}
if (existsSync(".env.local")) {
  loadEnvFile(".env.local");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is missing. Copy .env.example to .env.local and paste the Neon connection string from the console.",
  );
}

const TENANT_TABLES = [
  "agencies",
  "memberships",
  "stores",
  "warehouses",
  "carrier_cutoffs",
  "holidays",
  "skus",
  "inventory",
  "inventory_syncs",
  "orders",
  "order_lines",
  "shipments",
  "returns",
  "exception_rules",
  "exception_rule_versions",
  "exceptions",
  "audit_log",
  "webhook_events",
] as const;

async function main() {
  const sql = postgres(databaseUrl, { max: 1 });
  const agencyId = crypto.randomUUID();

  try {
    await sql.begin(async (tx) => {
      await tx`set local role fulfillment_app`;
      await tx`select set_config('app.current_agency_id', ${agencyId}, true)`;
      await tx`insert into agencies (id, name) values (${agencyId}, 'rls-check')`;
      await tx`
        insert into audit_log (
          agency_id, entity_type, entity_id, action, reason
        ) values (
          ${agencyId}, 'agencies', ${agencyId}, 'rls_check', 'phase 1 isolation check'
        )
      `;

      const withSession = await tx<{ n: number }[]>`select count(*)::int as n from agencies`;
      if (withSession[0]?.n !== 1) {
        throw new Error(`expected 1 agency with session set, got ${withSession[0]?.n ?? "none"}`);
      }

      await tx`select set_config('app.current_agency_id', '', true)`;

      for (const table of TENANT_TABLES) {
        const rows = await tx.unsafe(`select count(*)::int as n from ${table}`);
        const n = rows[0]?.n;
        if (n !== 0) {
          throw new Error(`${table}: expected 0 rows without app.current_agency_id, got ${String(n)}`);
        }
      }

      await tx`select set_config('app.current_agency_id', ${agencyId}, true)`;

      const privileges = await tx<{ upd: boolean; del: boolean }[]>`
        select
          has_table_privilege(current_user, 'audit_log', 'update') as upd,
          has_table_privilege(current_user, 'audit_log', 'delete') as del
      `;
      if (privileges[0]?.upd || privileges[0]?.del) {
        throw new Error("audit_log UPDATE/DELETE must be revoked at the database level");
      }

      throw new Error("RLS_CHECK_OK");
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== "RLS_CHECK_OK") {
      throw error;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  console.log("Phase 1 RLS check passed: tenant tables return 0 rows without app.current_agency_id; audit_log is append-only.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
