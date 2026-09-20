import { DEMO_AGENCY_ID, DEMO_AGENCY_NAME } from "@/queue/demo-session";
import { parseQueueFilters } from "@/queue/filters";
import { QueueFiltersForm } from "@/queue/queue-filters";
import { QueueTable } from "@/queue/queue-table";
import { loadQueue } from "@/queue/query";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: PageProps<"/">) {
  const filters = parseQueueFilters(await searchParams);
  const queue = await loadQueue(DEMO_AGENCY_ID, filters);

  return (
    <div className="flex flex-col gap-4 bg-zinc-50 px-6 py-5 text-zinc-900">
      <header className="flex flex-col gap-1">
        <p className="text-[11px] uppercase tracking-wide text-zinc-500">
          Screen 1 of 3 · {DEMO_AGENCY_NAME}
        </p>
        <h1 className="text-lg font-semibold">Exception queue</h1>
        <p className="text-xs text-zinc-600">
          {queue.rows.length} {filters.status} exception{queue.rows.length === 1 ? "" : "s"} ·
          filters are the URL · age is warehouse TZ, not a global cutoff
        </p>
      </header>
      <QueueFiltersForm
        filters={filters}
        stores={queue.stores}
        rules={queue.rules}
        members={queue.members}
      />
      <QueueTable rows={queue.rows} members={queue.members} />
    </div>
  );
}
