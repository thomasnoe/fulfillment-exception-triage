import { dayOfWeekInTimeZone, wallTimeOnZonedDate } from "@/workers/warehouse-clock";

export type CutoffLookup = {
  warehouseId: string;
  carrier: string;
  serviceLevel: string;
  dayOfWeek: number;
  cutoffTime: string;
};

/**
 * Carrier cutoff for this order's warehouse, carrier, service, and weekday —
 * in the warehouse IANA zone. Missing row ⇒ no age. Never invent a global hour.
 */
export function carrierCutoffAt(args: {
  now: Date;
  warehouseId: string | null;
  timezone: string | null;
  carrier: string | null;
  serviceLevel: string | null;
  cutoffs: CutoffLookup[];
}): Date | null {
  const { now, warehouseId, timezone, carrier, serviceLevel, cutoffs } = args;
  if (warehouseId === null || timezone === null || carrier === null || serviceLevel === null) {
    return null;
  }
  const dayOfWeek = dayOfWeekInTimeZone(now, timezone);
  const match = cutoffs.find(
    (row) =>
      row.warehouseId === warehouseId &&
      row.carrier === carrier &&
      row.serviceLevel === serviceLevel &&
      row.dayOfWeek === dayOfWeek,
  );
  if (match === undefined) {
    return null;
  }
  return wallTimeOnZonedDate(now, timezone, match.cutoffTime);
}

/** Positive = past cutoff. Negative = remaining. */
export function ageAgainstCutoffMs(now: Date, carrierCutoff: Date | null): number | null {
  if (carrierCutoff === null) {
    return null;
  }
  return now.getTime() - carrierCutoff.getTime();
}

export function formatAgeAgainstCutoff(deltaMs: number | null, timezone: string | null): string {
  if (deltaMs === null) {
    return "—";
  }
  const past = deltaMs >= 0;
  const absMinutes = Math.floor(Math.abs(deltaMs) / 60_000);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  const clock = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  const zone = timezone === null ? "" : ` ${timezone}`;
  return past ? `${clock} past${zone}` : `${clock} to cutoff${zone}`;
}

export function ageWeightClass(deltaMs: number | null): string {
  if (deltaMs === null) {
    return "text-zinc-400";
  }
  if (deltaMs >= 0) {
    return "font-semibold text-red-800";
  }
  if (deltaMs > -60 * 60 * 1000) {
    return "font-medium text-amber-800";
  }
  return "text-zinc-700";
}
