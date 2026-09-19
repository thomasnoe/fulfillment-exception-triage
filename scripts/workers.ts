import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { startWorkers } from "../src/workers/start";

if (existsSync(".env")) {
  loadEnvFile(".env");
}
if (existsSync(".env.local")) {
  loadEnvFile(".env.local");
}

async function main(): Promise<void> {
  const { stop } = await startWorkers();
  console.log("pg-boss aging-sweep and cutoff-clock scheduled every minute on this Neon database.");
  const shutdown = (): void => {
    void stop().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
