import type postgres from "postgres";
import { createSql, isUniqueViolation } from "@/db/sql";
import { requireWebhookSecret } from "@/db/env";
import { verifyWebhookSignature } from "@/ingest/hmac";
import { parseWebhookOrderPayload, type WebhookOrderPayload } from "@/ingest/payload";

export type WebhookProcessResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; status: 400 | 401; error: string };

async function ingestAcceptedEvent(
  tx: postgres.TransactionSql,
  agencyId: string,
  payload: WebhookOrderPayload,
  signature: string,
): Promise<void> {
  await tx`
    insert into webhook_events (
      agency_id, store_id, external_id, signature, payload
    ) values (
      ${agencyId},
      ${payload.store_id},
      ${payload.external_id},
      ${signature},
      ${tx.json({
        store_id: payload.store_id,
        external_id: payload.external_id,
        status: payload.status,
        placed_at: payload.placed_at,
        warehouse_id: payload.warehouse_id ?? null,
        carrier: payload.carrier ?? null,
        service_level: payload.service_level ?? null,
        lines: payload.lines,
      })}
    )
  `;

  await tx`
    insert into orders (
      agency_id, store_id, warehouse_id, external_id, status, placed_at, carrier, service_level
    ) values (
      ${agencyId},
      ${payload.store_id},
      ${payload.warehouse_id ?? null},
      ${payload.external_id},
      ${payload.status},
      ${payload.placed_at},
      ${payload.carrier ?? null},
      ${payload.service_level ?? null}
    )
    on conflict (store_id, external_id) do nothing
  `;

  const orderRows = await tx<{ id: string }[]>`
    select id from orders
    where store_id = ${payload.store_id} and external_id = ${payload.external_id}
  `;
  const orderId = orderRows[0]?.id;
  if (orderId === undefined) {
    throw new Error("order missing after ingest");
  }

  for (const line of payload.lines) {
    await tx`
      insert into order_lines (
        agency_id, order_id, sku_id, qty_ordered, qty_allocated, qty_picked, qty_shipped
      ) values (
        ${agencyId},
        ${orderId},
        ${line.sku_id},
        ${line.qty_ordered},
        ${line.qty_allocated ?? 0},
        ${line.qty_picked ?? 0},
        ${line.qty_shipped ?? 0}
      )
    `;
  }

  await tx`
    insert into audit_log (
      agency_id, entity_type, entity_id, action, after, reason
    ) values (
      ${agencyId},
      'orders',
      ${orderId},
      'ingest',
      ${tx.json({ external_id: payload.external_id, status: payload.status })},
      'webhook ingest'
    )
  `;
}

export async function processOrderWebhook(
  rawBody: string,
  signatureHeader: string | null,
  sqlClient?: postgres.Sql,
): Promise<WebhookProcessResult> {
  const secret = requireWebhookSecret();
  if (!verifyWebhookSignature(rawBody, signatureHeader, secret)) {
    return { ok: false, status: 401, error: "invalid webhook signature" };
  }

  let payload: WebhookOrderPayload;
  try {
    payload = parseWebhookOrderPayload(rawBody);
  } catch {
    return { ok: false, status: 400, error: "invalid webhook payload" };
  }

  const sql = sqlClient ?? createSql();
  const ownsClient = sqlClient === undefined;
  try {
    return await sql.begin(async (tx) => {
      const stores = await tx<{ agency_id: string }[]>`
        select agency_id from stores where id = ${payload.store_id}
      `;
      const agencyId = stores[0]?.agency_id;
      if (agencyId === undefined) {
        return { ok: false, status: 400 as const, error: "unknown store" };
      }

      await tx`set local role fulfillment_app`;
      await tx`select set_config('app.current_agency_id', ${agencyId}, true)`;

      try {
        await tx.savepoint(async (sp) => {
          await ingestAcceptedEvent(sp, agencyId, payload, signatureHeader ?? "");
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { ok: true, duplicate: true };
        }
        throw error;
      }
      return { ok: true, duplicate: false };
    });
  } finally {
    if (ownsClient) {
      await sql.end({ timeout: 5 });
    }
  }
}
