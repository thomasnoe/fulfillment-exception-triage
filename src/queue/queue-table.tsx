import { bulkAssign, bulkResolve } from "@/queue/actions";
import { ageWeightClass, formatAgeAgainstCutoff } from "@/queue/age-against-cutoff";
import type { QueueOption, QueueRow } from "@/queue/query";

type Props = {
  rows: QueueRow[];
  members: QueueOption[];
};

export function QueueTable({ rows, members }: Props) {
  return (
    <form className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select name="assigneeId" defaultValue="" className="border border-zinc-300 bg-white px-2 py-1">
          <option value="">Assign to…</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.label}
            </option>
          ))}
        </select>
        <button formAction={bulkAssign} className="border border-zinc-800 px-3 py-1">
          Assign
        </button>
        <input
          name="reason"
          type="text"
          placeholder="Resolution reason (required for resolve)"
          className="min-w-64 flex-1 border border-zinc-300 bg-white px-2 py-1"
        />
        <button formAction={bulkResolve} className="border border-zinc-800 px-3 py-1">
          Resolve
        </button>
        {/* TODO(thomas): empty-selection UX; select-all; j/k keyboard; 5s poll */}
      </div>
      <div className="overflow-x-auto border border-zinc-200">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-zinc-100 text-[11px] uppercase tracking-wide text-zinc-600">
            <tr>
              <th className="w-8 px-2 py-2">{/* TODO(thomas): select-all */}</th>
              <th className="px-2 py-2">Order</th>
              <th className="px-2 py-2">Store</th>
              <th className="px-2 py-2">Rule / version</th>
              <th className="px-2 py-2">Sev</th>
              <th className="px-2 py-2">Attributed</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">
                Age vs cutoff
                {/* TODO(thomas): clickable sort via ?sort=age; default is already age-desc */}
              </th>
              <th className="px-2 py-2">Assignee</th>
              {/* TODO(thomas): order status, warehouse, opened_at — keep this dense */}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-2 py-8 text-center text-zinc-500">
                  No exceptions match these filters.
                  {/* TODO(thomas): empty state copy + planted-failure hints */}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-zinc-200 odd:bg-white even:bg-zinc-50">
                  <td className="px-2 py-1.5">
                    <input type="checkbox" name="exceptionIds" value={row.id} />
                  </td>
                  <td className="px-2 py-1.5 font-mono">
                    {row.orderExternalId}
                    {/* TODO(thomas): Phase 7 — link to exception detail */}
                  </td>
                  <td className="px-2 py-1.5">{row.storeName}</td>
                  <td className="px-2 py-1.5">
                    <div>{row.ruleKey}</div>
                    <code title={row.ruleVersionId} className="block max-w-[12rem] truncate text-[10px] text-zinc-500">
                      v{row.ruleVersion} {row.ruleVersionId}
                    </code>
                  </td>
                  <td className="px-2 py-1.5">{row.severity}</td>
                  <td className="px-2 py-1.5">{row.attributedTo}</td>
                  <td className="px-2 py-1.5">{row.status}</td>
                  <td className={`px-2 py-1.5 ${ageWeightClass(row.deltaMs)}`}>
                    {formatAgeAgainstCutoff(row.deltaMs, row.warehouseTimezone)}
                  </td>
                  <td className="px-2 py-1.5">{row.assigneeName ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </form>
  );
}
