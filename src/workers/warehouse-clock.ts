const WEEKDAY_TO_DOW: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function zonedParts(at: Date, timeZone: string): Record<string, string> {
  const entries = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(at)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value] as const);
  return Object.fromEntries(entries);
}

function requirePart(parts: Record<string, string>, type: string): string {
  const value = parts[type];
  if (value === undefined) {
    throw new Error(`timezone ${type} missing from Intl parts`);
  }
  return value;
}

/** Postgres `extract(dow)` / seed `day_of_week`: Sunday = 0. */
export function dayOfWeekInTimeZone(at: Date, timeZone: string): number {
  const weekday = requirePart(zonedParts(at, timeZone), "weekday");
  const dow = WEEKDAY_TO_DOW[weekday];
  if (dow === undefined) {
    throw new Error(`unrecognized weekday ${weekday}`);
  }
  return dow;
}

export function calendarDateInTimeZone(
  at: Date,
  timeZone: string,
): { year: number; month: number; day: number; isoDate: string } {
  const parts = zonedParts(at, timeZone);
  const year = Number(requirePart(parts, "year"));
  const month = Number(requirePart(parts, "month"));
  const day = Number(requirePart(parts, "day"));
  const isoDate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { year, month, day, isoDate };
}

function offsetMsAt(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  let hour = Number(requirePart(parts, "hour"));
  if (hour === 24) {
    hour = 0;
  }
  const asUtc = Date.UTC(
    Number(requirePart(parts, "year")),
    Number(requirePart(parts, "month")) - 1,
    Number(requirePart(parts, "day")),
    hour,
    Number(requirePart(parts, "minute")),
    Number(requirePart(parts, "second")),
  );
  return asUtc - instant.getTime();
}

export function parseCutoffTime(cutoffTime: string): { hour: number; minute: number; second: number } {
  const match = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/.exec(cutoffTime);
  if (match === null) {
    throw new Error(`invalid cutoff_time ${cutoffTime}`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);
  return { hour, minute, second };
}

/** Instant of a warehouse-local wall time on the calendar date of `at` in that IANA zone. */
export function wallTimeOnZonedDate(at: Date, timeZone: string, cutoffTime: string): Date {
  const { year, month, day } = calendarDateInTimeZone(at, timeZone);
  const { hour, minute, second } = parseCutoffTime(cutoffTime);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = new Date(utcGuess - offsetMsAt(new Date(utcGuess), timeZone));
  return new Date(utcGuess - offsetMsAt(first, timeZone));
}
