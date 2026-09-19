import { PgBoss, type Job } from "pg-boss";
import type postgres from "postgres";
import { createSql } from "../db/sql";
import { requireDatabaseUrl } from "../db/env";
import { CUTOFF_CLOCK_QUEUE, AGING_SWEEP_QUEUE } from "./queues";
import { nowFromJobData, runAgingSweep, runCutoffClock } from "./sweep";

type ClockJob = Job<{ nowIso?: string }>;

export async function startWorkers(sqlClient?: postgres.Sql): Promise<{
  boss: PgBoss;
  sql: postgres.Sql;
  stop: () => Promise<void>;
}> {
  const sql = sqlClient ?? createSql();
  const ownsSql = sqlClient === undefined;
  const boss = new PgBoss({
    connectionString: requireDatabaseUrl(),
    application_name: "fulfillment-exception-triage-workers",
  });
  await boss.start();
  if ((await boss.getQueue(AGING_SWEEP_QUEUE)) === null) {
    await boss.createQueue(AGING_SWEEP_QUEUE);
  }
  if ((await boss.getQueue(CUTOFF_CLOCK_QUEUE)) === null) {
    await boss.createQueue(CUTOFF_CLOCK_QUEUE);
  }
  await boss.work(AGING_SWEEP_QUEUE, async (jobs: ClockJob[]) => {
    const job = jobs[0];
    const now = nowFromJobData(job?.data);
    await runAgingSweep(sql, now);
  });
  await boss.work(CUTOFF_CLOCK_QUEUE, async (jobs: ClockJob[]) => {
    const job = jobs[0];
    const now = nowFromJobData(job?.data);
    await runCutoffClock(sql, now);
  });
  await boss.schedule(AGING_SWEEP_QUEUE, "*/1 * * * *", null, { tz: "UTC" });
  await boss.schedule(CUTOFF_CLOCK_QUEUE, "*/1 * * * *", null, { tz: "UTC" });

  const stop = async (): Promise<void> => {
    await boss.stop({ graceful: true, timeout: 10_000 });
    if (ownsSql) {
      await sql.end({ timeout: 5 });
    }
  };
  return { boss, sql, stop };
}
