import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { createSql } from "../src/db/sql";
import { signWebhookBody } from "../src/ingest/hmac";
import { processOrderWebhook } from "../src/ingest/process-webhook";
import { requireWebhookSecret } from "../src/db/env";

if (existsSync(".env")) {
  loadEnvFile(".env");
}
if (existsSync(".env.local")) {
  loadEnvFile(".env.local");
}

const STORE_HARBOR = "d0000000-0000-4000-8000-000000000001";
const HARBOR_SKU = "11111111-0000-4000-8000-000000000100";
const EXTERNAL_ID = "WEBHOOK-REPLAY-50";

async function main(): Promise<void> {
  const secret = requireWebhookSecret();
  const payload = {
    store_id: STORE_HARBOR,
    external_id: EXTERNAL_ID,
    status: "RECEIVED",
    placed_at: new Date().toISOString(),
    lines: [{ sku_id: HARBOR_SKU, qty_ordered: 1 }],
  };
  const rawBody = JSON.stringify(payload);
  const signature = signWebhookBody(rawBody, secret);
    const sql = createSql();

  try {
    await sql`
      delete from order_lines
      where order_id in (
        select id from orders where store_id = ${STORE_HARBOR} and external_id = ${EXTERNAL_ID}
      )
    `;
    await sql`
      delete from orders where store_id = ${STORE_HARBOR} and external_id = ${EXTERNAL_ID}
    `;
    await sql`
      delete from webhook_events where store_id = ${STORE_HARBOR} and external_id = ${EXTERNAL_ID}
    `;

    const beforeRows = await sql<{ n: number }[]>`select count(*)::int as n from orders`;
    const before = beforeRows[0]?.n ?? 0;

    let accepted = 0;
    let duplicates = 0;
    for (let i = 0; i < 50; i += 1) {
      const result = await processOrderWebhook(rawBody, signature, sql);
      if (!result.ok) {
        throw new Error(`replay ${i} failed: ${result.error}`);
      }
      if (result.duplicate) {
        duplicates += 1;
      } else {
        accepted += 1;
      }
    }

    const afterRows = await sql<{ n: number }[]>`select count(*)::int as n from orders`;
    const after = afterRows[0]?.n ?? 0;
    const created = after - before;

    if (accepted !== 1 || duplicates !== 49 || created !== 1) {
      throw new Error(
        `Phase 3 check failed: accepted=${accepted} duplicates=${duplicates} order_delta=${created} (want 1 / 49 / 1)`,
      );
    }

    console.log(
      `Phase 3 check passed: 50 identical webhooks, orders +${created}, accepted=${accepted}, duplicates=${duplicates}.`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
