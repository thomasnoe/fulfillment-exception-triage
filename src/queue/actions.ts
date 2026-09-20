"use server";

import { revalidatePath } from "next/cache";
import type postgres from "postgres";
import { z } from "zod";
import { getAppSql } from "@/db/sql";
import { withTenant } from "@/db/tenant";
import { DEMO_ACTOR_ID, DEMO_AGENCY_ID } from "@/queue/demo-session";

const idsSchema = z.array(z.uuid()).min(1);

const assignSchema = z.object({
  exceptionIds: idsSchema,
  assigneeId: z.uuid(),
});

const resolveSchema = z.object({
  exceptionIds: idsSchema,
  reason: z.string().trim().min(1),
});

type Snapshot = {
  id: string;
  status: string;
  assignee_id: string | null;
  resolved_at: Date | null;
  resolution_note: string | null;
};

function readIds(formData: FormData): string[] {
  return formData.getAll("exceptionIds").filter((value): value is string => typeof value === "string");
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function loadSnapshots(tx: postgres.TransactionSql, ids: string[]): Promise<Snapshot[]> {
  return tx<Snapshot[]>`
    select id, status, assignee_id, resolved_at, resolution_note
    from exceptions
    where id in ${tx(ids)}
  `;
}

/**
 * Bulk assign. Mutation and audit_log insert share one transaction.
 * audit_log is append-only — this path never UPDATE/DELETE it.
 *
 * TODO(thomas): Phase 9 — reject read_only here, not only by hiding the form.
 */
export async function bulkAssign(formData: FormData): Promise<void> {
  const ids = readIds(formData);
  const assigneeId = readString(formData, "assigneeId");
  if (ids.length === 0 || assigneeId.length === 0) {
    return;
  }
  const parsed = assignSchema.parse({
    exceptionIds: ids,
    assigneeId,
  });
  await withTenant(getAppSql(), DEMO_AGENCY_ID, async (tx) => {
    const member = await tx<{ id: string }[]>`
      select user_id as id from memberships where user_id = ${parsed.assigneeId}
    `;
    if (member[0] === undefined) {
      throw new Error("assignee is not a member of this agency");
    }
    const before = await loadSnapshots(tx, parsed.exceptionIds);
    if (before.length === 0) {
      return;
    }
    const updated = await tx<Snapshot[]>`
      update exceptions
      set assignee_id = ${parsed.assigneeId}, status = 'assigned'
      where id in ${tx(before.map((row) => row.id))}
        and status in ('open', 'assigned')
      returning id, status, assignee_id, resolved_at, resolution_note
    `;
    for (const row of updated) {
      const previous = before.find((item) => item.id === row.id);
      await tx`
        insert into audit_log (
          agency_id, actor_id, entity_type, entity_id, action, before, after, reason
        ) values (
          ${DEMO_AGENCY_ID},
          ${DEMO_ACTOR_ID},
          'exceptions',
          ${row.id},
          'assign',
          ${tx.json({
            status: previous?.status ?? null,
            assigneeId: previous?.assignee_id ?? null,
          })},
          ${tx.json({
            status: row.status,
            assigneeId: row.assignee_id,
          })},
          'bulk assign'
        )
      `;
    }
  });
  revalidatePath("/");
}

/**
 * Bulk resolve with a required reason. Same txn as the audit row.
 * Resolution note is stored on the exception; the reason also lands on audit_log
 * so Phase 7 can render it on the timeline without mutating history.
 */
export async function bulkResolve(formData: FormData): Promise<void> {
  const ids = readIds(formData);
  const reason = readString(formData, "reason");
  if (ids.length === 0 || reason.trim().length === 0) {
    return;
  }
  const parsed = resolveSchema.parse({
    exceptionIds: ids,
    reason,
  });
  await withTenant(getAppSql(), DEMO_AGENCY_ID, async (tx) => {
    const before = await loadSnapshots(tx, parsed.exceptionIds);
    if (before.length === 0) {
      return;
    }
    const updated = await tx<Snapshot[]>`
      update exceptions
      set
        status = 'resolved',
        resolved_at = now(),
        resolution_note = ${parsed.reason}
      where id in ${tx(before.map((row) => row.id))}
        and status <> 'resolved'
      returning id, status, assignee_id, resolved_at, resolution_note
    `;
    for (const row of updated) {
      const previous = before.find((item) => item.id === row.id);
      await tx`
        insert into audit_log (
          agency_id, actor_id, entity_type, entity_id, action, before, after, reason
        ) values (
          ${DEMO_AGENCY_ID},
          ${DEMO_ACTOR_ID},
          'exceptions',
          ${row.id},
          'resolve',
          ${tx.json({
            status: previous?.status ?? null,
            assigneeId: previous?.assignee_id ?? null,
            resolvedAt: previous?.resolved_at ?? null,
            resolutionNote: previous?.resolution_note ?? null,
          })},
          ${tx.json({
            status: row.status,
            assigneeId: row.assignee_id,
            resolvedAt: row.resolved_at,
            resolutionNote: row.resolution_note,
          })},
          ${parsed.reason}
        )
      `;
    }
  });
  revalidatePath("/");
}
