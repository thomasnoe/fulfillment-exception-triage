import type postgres from "postgres";

/**
 * Every queue read/write goes through here: SET ROLE so RLS applies, then the
 * tenant session variable. Do not query exceptions as the table owner.
 */
export async function withTenant<T>(
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
