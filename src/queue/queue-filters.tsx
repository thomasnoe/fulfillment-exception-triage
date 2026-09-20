import Link from "next/link";
import {
  ATTRIBUTION_OPTIONS,
  SEVERITY_OPTIONS,
  STATUS_OPTIONS,
  type QueueFilters,
} from "@/queue/filters";
import type { QueueOption } from "@/queue/query";

type Props = {
  filters: QueueFilters;
  stores: QueueOption[];
  rules: QueueOption[];
  members: QueueOption[];
};

export function QueueFiltersForm({ filters, stores, rules, members }: Props) {
  return (
    <form method="get" action="/" className="flex flex-wrap items-end gap-2 text-xs">
      <label className="flex flex-col gap-1">
        Store
        <select name="store" defaultValue={filters.store ?? ""} className="border border-zinc-300 bg-white px-2 py-1">
          <option value="">All</option>
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Rule
        <select name="rule" defaultValue={filters.rule ?? ""} className="border border-zinc-300 bg-white px-2 py-1">
          <option value="">All</option>
          {rules.map((rule) => (
            <option key={rule.id} value={rule.id}>
              {rule.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Severity
        <select
          name="severity"
          defaultValue={filters.severity ?? ""}
          className="border border-zinc-300 bg-white px-2 py-1"
        >
          <option value="">All</option>
          {SEVERITY_OPTIONS.map((severity) => (
            <option key={severity} value={severity}>
              {severity}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Attribution
        <select
          name="attributedTo"
          defaultValue={filters.attributedTo ?? ""}
          className="border border-zinc-300 bg-white px-2 py-1"
        >
          <option value="">All</option>
          {ATTRIBUTION_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Status
        <select name="status" defaultValue={filters.status} className="border border-zinc-300 bg-white px-2 py-1">
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Assignee
        <select
          name="assignee"
          defaultValue={filters.assignee ?? ""}
          className="border border-zinc-300 bg-white px-2 py-1"
        >
          <option value="">All</option>
          <option value="unassigned">Unassigned</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="border border-zinc-800 bg-zinc-900 px-3 py-1 text-white">
        Apply
      </button>
      <Link href="/" className="px-2 py-1 text-zinc-600 underline">
        Reset
      </Link>
    </form>
  );
}
