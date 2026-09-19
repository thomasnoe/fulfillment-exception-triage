import postgres from "postgres";
import { requireDatabaseUrl } from "./env";

export function createSql(): postgres.Sql {
  return postgres(requireDatabaseUrl(), { max: 1 });
}

export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  if ("code" in error && error.code === "23505") {
    return true;
  }
  if (
    "constraint_name" in error &&
    error.constraint_name === "webhook_events_store_id_external_id"
  ) {
    return true;
  }
  if ("cause" in error) {
    return isUniqueViolation(error.cause);
  }
  return false;
}
