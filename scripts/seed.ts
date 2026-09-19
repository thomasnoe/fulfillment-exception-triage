import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import postgres, { type Sql } from "postgres";

if (existsSync(".env")) {
  loadEnvFile(".env");
}
if (existsSync(".env.local")) {
  loadEnvFile(".env.local");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is missing. Copy .env.example to .env.local and paste the Neon connection string from the console.",
  );
}

const RULE_KEYS = [
  "missed_carrier_cutoff",
  "allocation_failure",
  "address_validation_failure",
  "short_pick",
  "stuck_in_status",
  "return_pending_disposition",
] as const;

type RuleKey = (typeof RULE_KEYS)[number];
type Severity = "critical" | "high" | "medium" | "low";
type Attribution = "merchant" | "warehouse" | "carrier" | "integration";
type OrderStatus =
  | "RECEIVED"
  | "VALIDATED"
  | "ON_HOLD"
  | "ALLOCATED"
  | "BACKORDERED"
  | "RELEASED"
  | "PICKING"
  | "PICKED"
  | "PACKED"
  | "MANIFESTED"
  | "STAGED"
  | "SHIPPED"
  | "PARTIALLY_SHIPPED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "CANCELLED";

const AGENCY_A = "a0000000-0000-4000-8000-000000000001";
const AGENCY_B = "a0000000-0000-4000-8000-000000000002";
const USER_OWNER_A = "b0000000-0000-4000-8000-000000000001";
const USER_ANALYST_A = "b0000000-0000-4000-8000-000000000002";
const USER_OWNER_B = "b0000000-0000-4000-8000-000000000003";
const USER_RO_B = "b0000000-0000-4000-8000-000000000004";
const WH_EWR = "c0000000-0000-4000-8000-000000000001";
const WH_LAX = "c0000000-0000-4000-8000-000000000002";
const STORE_HARBOR = "d0000000-0000-4000-8000-000000000001";
const STORE_PEAK = "d0000000-0000-4000-8000-000000000002";
const STORE_CINDER = "d0000000-0000-4000-8000-000000000003";
const STORE_LUMEN = "d0000000-0000-4000-8000-000000000004";

const RULE_CONFIG: Record<RuleKey, Record<string, unknown>> = {
  missed_carrier_cutoff: { requiredStatusByCutoff: "STAGED" },
  allocation_failure: {
    syncLagMeansIntegration: true,
    countVarianceMeansWarehouse: true,
  },
  address_validation_failure: {},
  short_pick: {},
  stuck_in_status: {
    thresholdMinutes: {
      ALLOCATED: 240,
      PICKING: 180,
      PACKED: 120,
      MANIFESTED: 90,
    },
    escalateToCriticalMinutesBeforeCutoff: 60,
  },
  return_pending_disposition: { pendingHours: 72 },
};

function id(prefix: string, n: number): string {
  return `${prefix}-0000-4000-8000-${n.toString().padStart(12, "0")}`;
}

function ruleId(agencyId: string, key: RuleKey): string {
  const n = RULE_KEYS.indexOf(key) + 1;
  const agencyN = agencyId === AGENCY_A ? 1 : 2;
  return id("e0000000", agencyN * 10 + n);
}

function versionId(agencyId: string, key: RuleKey): string {
  const n = RULE_KEYS.indexOf(key) + 1;
  const agencyN = agencyId === AGENCY_A ? 1 : 2;
  return id("f0000000", agencyN * 10 + n);
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function daysAgo(days: number): Date {
  return hoursAgo(days * 24);
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pickTerminalStatus(rng: () => number): OrderStatus {
  const x = rng();
  if (x < 0.62) {
    return "DELIVERED";
  }
  if (x < 0.88) {
    return "SHIPPED";
  }
  if (x < 0.96) {
    return "CANCELLED";
  }
  return "IN_TRANSIT";
}

async function withTenant<T>(
  sql: Sql,
  agencyId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`set local role fulfillment_app`;
    await tx`select set_config('app.current_agency_id', ${agencyId}, true)`;
    return fn(tx);
  });
}

async function wipeOperational(sql: Sql, agencyIds: string[]): Promise<void> {
  await sql`
    delete from exceptions where agency_id in ${sql(agencyIds)}
  `;
  await sql`
    delete from webhook_events where agency_id in ${sql(agencyIds)}
  `;
  await sql`
    delete from returns where agency_id in ${sql(agencyIds)}
  `;
  await sql`
    delete from shipments where agency_id in ${sql(agencyIds)}
  `;
  await sql`
    delete from order_lines where agency_id in ${sql(agencyIds)}
  `;
  await sql`
    delete from orders where agency_id in ${sql(agencyIds)}
  `;
  await sql`
    delete from inventory where agency_id in ${sql(agencyIds)}
  `;
  await sql`
    delete from inventory_syncs where agency_id in ${sql(agencyIds)}
  `;
  await sql`
    delete from skus where agency_id in ${sql(agencyIds)}
  `;
  await sql`
    delete from holidays where agency_id in ${sql(agencyIds)}
  `;
  await sql`
    delete from carrier_cutoffs where agency_id in ${sql(agencyIds)}
  `;
}

async function upsertOrg(sql: Sql): Promise<void> {
  await sql`
    insert into users (id, email, name) values
      (${USER_OWNER_A}, 'owner.north@example.com', 'Avery North'),
      (${USER_ANALYST_A}, 'analyst.north@example.com', 'Jules North'),
      (${USER_OWNER_B}, 'owner.west@example.com', 'Casey West'),
      (${USER_RO_B}, 'readonly.west@example.com', 'Riley West')
    on conflict (id) do nothing
  `;

  await withTenant(sql, AGENCY_A, async (tx) => {
    await tx`
      insert into agencies (id, name) values (${AGENCY_A}, 'Northwind Fulfillment')
      on conflict (id) do nothing
    `;
    await tx`
      insert into memberships (user_id, agency_id, role) values
        (${USER_OWNER_A}, ${AGENCY_A}, 'owner'),
        (${USER_ANALYST_A}, ${AGENCY_A}, 'analyst')
      on conflict (user_id, agency_id) do nothing
    `;
    await tx`
      insert into warehouses (id, agency_id, name, timezone) values
        (${WH_EWR}, ${AGENCY_A}, 'EWR DC', 'America/New_York')
      on conflict (id) do nothing
    `;
    await tx`
      insert into stores (id, agency_id, channel, name, sync_interval_minutes) values
        (${STORE_HARBOR}, ${AGENCY_A}, 'shopify', 'Harbor & Vine', 15),
        (${STORE_PEAK}, ${AGENCY_A}, 'shopify', 'Peak Outfitters', 60)
      on conflict (id) do nothing
    `;
  });

  await withTenant(sql, AGENCY_B, async (tx) => {
    await tx`
      insert into agencies (id, name) values (${AGENCY_B}, 'Cascadia 3PL')
      on conflict (id) do nothing
    `;
    await tx`
      insert into memberships (user_id, agency_id, role) values
        (${USER_OWNER_B}, ${AGENCY_B}, 'owner'),
        (${USER_RO_B}, ${AGENCY_B}, 'read_only')
      on conflict (user_id, agency_id) do nothing
    `;
    await tx`
      insert into warehouses (id, agency_id, name, timezone) values
        (${WH_LAX}, ${AGENCY_B}, 'LAX DC', 'America/Los_Angeles')
      on conflict (id) do nothing
    `;
    await tx`
      insert into stores (id, agency_id, channel, name, sync_interval_minutes) values
        (${STORE_CINDER}, ${AGENCY_B}, 'shopify', 'Cinder Supply', 30),
        (${STORE_LUMEN}, ${AGENCY_B}, 'shopify', 'Lumen Home', 45)
      on conflict (id) do nothing
    `;
  });
}

async function upsertRules(sql: Sql, agencyId: string, createdBy: string): Promise<void> {
  await withTenant(sql, agencyId, async (tx) => {
    for (const key of RULE_KEYS) {
      const rid = ruleId(agencyId, key);
      const vid = versionId(agencyId, key);
      await tx`
        insert into exception_rules (id, agency_id, key, enabled, current_version_id)
        values (${rid}, ${agencyId}, ${key}, true, null)
        on conflict (agency_id, key) do nothing
      `;
      await tx`
        insert into exception_rule_versions (id, agency_id, rule_id, version, config, created_by)
        values (${vid}, ${agencyId}, ${rid}, 1, ${tx.json(RULE_CONFIG[key])}, ${createdBy})
        on conflict (id) do nothing
      `;
      await tx`
        update exception_rules
        set current_version_id = ${vid}
        where id = ${rid} and current_version_id is null
      `;
    }
  });
}

async function seedCutoffsAndCatalog(
  sql: Sql,
  agencyId: string,
  warehouseId: string,
  storeIds: string[],
  cutoffTime: string,
): Promise<Record<string, string[]>> {
  const skuIdsByStore: Record<string, string[]> = {};
  await withTenant(sql, agencyId, async (tx) => {
    for (let day = 0; day <= 6; day += 1) {
      await tx`
        insert into carrier_cutoffs (
          agency_id, warehouse_id, carrier, service_level, day_of_week, cutoff_time
        ) values
          (${agencyId}, ${warehouseId}, 'UPS', 'ground', ${day}, ${cutoffTime}::time),
          (${agencyId}, ${warehouseId}, 'FedEx', 'ground', ${day}, ${cutoffTime}::time)
      `;
    }
    await tx`
      insert into holidays (agency_id, warehouse_id, observed_on, name)
      values (${agencyId}, ${warehouseId}, '2026-07-04', 'Independence Day')
    `;

    let skuN = agencyId === AGENCY_A ? 100 : 200;
    for (const storeId of storeIds) {
      const ids: string[] = [];
      for (let i = 1; i <= 3; i += 1) {
        const skuRowId = id("11111111", skuN);
        skuN += 1;
        ids.push(skuRowId);
        await tx`
          insert into skus (id, agency_id, store_id, external_id)
          values (${skuRowId}, ${agencyId}, ${storeId}, ${`SKU-${storeId.slice(-4)}-${i}`})
        `;
        await tx`
          insert into inventory (
            agency_id, sku_id, warehouse_id, on_hand, allocated, held, pending_disposition
          ) values (
            ${agencyId}, ${skuRowId}, ${warehouseId}, 80, 4, 0, 0
          )
        `;
      }
      skuIdsByStore[storeId] = ids;
    }
  });
  return skuIdsByStore;
}

type Planted = {
  orderId: string;
  storeId: string;
  warehouseId: string;
  skuId: string;
  externalId: string;
  status: OrderStatus;
  placedAt: Date;
  qtyOrdered: number;
  qtyAllocated: number;
  qtyPicked: number;
  qtyShipped: number;
  tracking: string | null;
  returnReceivedAt?: Date;
  exception: {
    key: RuleKey;
    severity: Severity;
    attributedTo: Attribution;
  };
};

function plantedNorth(skuHarbor: string, skuPeak: string): Planted[] {
  const packedBase = hoursAgo(5);
  return [
    {
      orderId: id("22222222", 1),
      storeId: STORE_HARBOR,
      warehouseId: WH_EWR,
      skuId: skuHarbor,
      externalId: "SEED-SYNC-LAG",
      status: "BACKORDERED",
      placedAt: hoursAgo(6),
      qtyOrdered: 4,
      qtyAllocated: 1,
      qtyPicked: 0,
      qtyShipped: 0,
      tracking: null,
      exception: {
        key: "allocation_failure",
        severity: "critical",
        attributedTo: "integration",
      },
    },
    {
      orderId: id("22222222", 2),
      storeId: STORE_PEAK,
      warehouseId: WH_EWR,
      skuId: skuPeak,
      externalId: "SEED-COUNT-VAR",
      status: "BACKORDERED",
      placedAt: hoursAgo(4),
      qtyOrdered: 6,
      qtyAllocated: 2,
      qtyPicked: 0,
      qtyShipped: 0,
      tracking: null,
      exception: {
        key: "allocation_failure",
        severity: "critical",
        attributedTo: "warehouse",
      },
    },
    {
      orderId: id("22222222", 3),
      storeId: STORE_HARBOR,
      warehouseId: WH_EWR,
      skuId: skuHarbor,
      externalId: "SEED-PACKED-1",
      status: "PACKED",
      placedAt: packedBase,
      qtyOrdered: 2,
      qtyAllocated: 2,
      qtyPicked: 2,
      qtyShipped: 0,
      tracking: null,
      exception: {
        key: "stuck_in_status",
        severity: "medium",
        attributedTo: "warehouse",
      },
    },
    {
      orderId: id("22222222", 4),
      storeId: STORE_HARBOR,
      warehouseId: WH_EWR,
      skuId: skuHarbor,
      externalId: "SEED-PACKED-2",
      status: "PACKED",
      placedAt: hoursAgo(6),
      qtyOrdered: 1,
      qtyAllocated: 1,
      qtyPicked: 1,
      qtyShipped: 0,
      tracking: null,
      exception: {
        key: "stuck_in_status",
        severity: "medium",
        attributedTo: "warehouse",
      },
    },
    {
      orderId: id("22222222", 5),
      storeId: STORE_PEAK,
      warehouseId: WH_EWR,
      skuId: skuPeak,
      externalId: "SEED-PACKED-3",
      status: "PACKED",
      placedAt: hoursAgo(7),
      qtyOrdered: 3,
      qtyAllocated: 3,
      qtyPicked: 3,
      qtyShipped: 0,
      tracking: null,
      exception: {
        key: "stuck_in_status",
        severity: "medium",
        attributedTo: "warehouse",
      },
    },
    {
      orderId: id("22222222", 6),
      storeId: STORE_HARBOR,
      warehouseId: WH_EWR,
      skuId: skuHarbor,
      externalId: "SEED-RETURN-11D",
      status: "DELIVERED",
      placedAt: daysAgo(24),
      qtyOrdered: 2,
      qtyAllocated: 2,
      qtyPicked: 2,
      qtyShipped: 2,
      tracking: "1ZSEEDRETURN11",
      returnReceivedAt: daysAgo(11),
      exception: {
        key: "return_pending_disposition",
        severity: "low",
        attributedTo: "warehouse",
      },
    },
  ];
}

async function insertOrderBundle(
  tx: postgres.TransactionSql,
  agencyId: string,
  planted: Planted,
  carrier: string,
  service: string,
): Promise<void> {
  await tx`
    insert into orders (
      id, agency_id, store_id, warehouse_id, external_id, status, placed_at, carrier, service_level
    ) values (
      ${planted.orderId}, ${agencyId}, ${planted.storeId}, ${planted.warehouseId},
      ${planted.externalId}, ${planted.status}, ${planted.placedAt}, ${carrier}, ${service}
    )
  `;
  await tx`
    insert into order_lines (
      agency_id, order_id, sku_id, qty_ordered, qty_allocated, qty_picked, qty_shipped
    ) values (
      ${agencyId}, ${planted.orderId}, ${planted.skuId},
      ${planted.qtyOrdered}, ${planted.qtyAllocated}, ${planted.qtyPicked}, ${planted.qtyShipped}
    )
  `;
  if (planted.status === "SHIPPED" || planted.status === "DELIVERED" || planted.status === "IN_TRANSIT") {
    await tx`
      insert into shipments (
        agency_id, order_id, carrier, service_level, tracking, manifested_at, first_scan_at
      ) values (
        ${agencyId}, ${planted.orderId}, ${carrier}, ${service}, ${planted.tracking},
        ${hoursAgo(48)}, ${planted.tracking ? hoursAgo(40) : null}
      )
    `;
  } else if (planted.status === "PACKED" && planted.tracking === null) {
    await tx`
      insert into shipments (
        agency_id, order_id, carrier, service_level, tracking, manifested_at, first_scan_at
      ) values (
        ${agencyId}, ${planted.orderId}, ${carrier}, ${service}, null, null, null
      )
    `;
  }
  if (planted.returnReceivedAt) {
    await tx`
      insert into returns (agency_id, order_id, received_at, dispositioned_at, disposition)
      values (${agencyId}, ${planted.orderId}, ${planted.returnReceivedAt}, null, null)
    `;
  }
}

async function insertException(
  tx: postgres.TransactionSql,
  agencyId: string,
  orderId: string,
  ruleKey: RuleKey,
  severity: Severity,
  attributedTo: Attribution,
  openedAt: Date,
): Promise<void> {
  const vid = versionId(agencyId, ruleKey);
  await tx`
    insert into exceptions (
      agency_id, order_id, rule_version_id, severity, attributed_to, status, opened_at
    ) values (
      ${agencyId}, ${orderId}, ${vid}, ${severity}, ${attributedTo}, 'open', ${openedAt}
    )
  `;
}

async function seedAgencyOrders(
  sql: Sql,
  opts: {
    agencyId: string;
    warehouseId: string;
    stores: string[];
    skuIdsByStore: Record<string, string[]>;
    rngSeed: number;
    healthyCount: number;
    extraExceptions: Array<{
      storeId: string;
      status: OrderStatus;
      key: RuleKey;
      severity: Severity;
      attributedTo: Attribution;
      hoursInStatus: number;
      shortPick?: boolean;
      missedCutoff?: boolean;
      addressHold?: boolean;
    }>;
    planted: Planted[];
    laggedSyncStoreId?: string;
    freshSyncStoreId?: string;
  },
): Promise<number> {
  let open = 0;
  await withTenant(sql, opts.agencyId, async (tx) => {
    if (opts.laggedSyncStoreId) {
      await tx`
        insert into inventory_syncs (agency_id, store_id, synced_at, source)
        values (${opts.agencyId}, ${opts.laggedSyncStoreId}, ${hoursAgo(6)}, 'shopify')
      `;
    }
    if (opts.freshSyncStoreId) {
      await tx`
        insert into inventory_syncs (agency_id, store_id, synced_at, source)
        values (${opts.agencyId}, ${opts.freshSyncStoreId}, ${hoursAgo(0.2)}, 'shopify')
      `;
    }

    for (const row of opts.planted) {
      await insertOrderBundle(tx, opts.agencyId, row, "UPS", "ground");
      await insertException(
        tx,
        opts.agencyId,
        row.orderId,
        row.exception.key,
        row.exception.severity,
        row.exception.attributedTo,
        row.placedAt,
      );
      open += 1;
    }

    const rng = mulberry32(opts.rngSeed);
    for (let i = 0; i < opts.healthyCount; i += 1) {
      const storeId = opts.stores[i % opts.stores.length];
      if (storeId === undefined) {
        throw new Error("store missing");
      }
      const skus = opts.skuIdsByStore[storeId];
      const skuId = skus?.[i % (skus.length || 1)];
      if (skuId === undefined) {
        throw new Error("sku missing");
      }
      const status = pickTerminalStatus(rng);
      const placedAt = daysAgo(1 + Math.floor(rng() * 59));
      const orderId = id("33333333", opts.rngSeed + i);
      const shipped = status === "CANCELLED" ? 0 : 2;
      await insertOrderBundle(
        tx,
        opts.agencyId,
        {
          orderId,
          storeId,
          warehouseId: opts.warehouseId,
          skuId,
          externalId: `ORD-${opts.rngSeed}-${i}`,
          status,
          placedAt,
          qtyOrdered: 2,
          qtyAllocated: shipped,
          qtyPicked: shipped,
          qtyShipped: shipped,
          tracking: status === "CANCELLED" ? null : `1Z${opts.rngSeed}${i}`,
          exception: {
            key: "stuck_in_status",
            severity: "medium",
            attributedTo: "warehouse",
          },
        },
        rng() < 0.5 ? "UPS" : "FedEx",
        "ground",
      );
    }

    for (const [idx, extra] of opts.extraExceptions.entries()) {
      const skus = opts.skuIdsByStore[extra.storeId];
      const skuId = skus?.[0];
      if (skuId === undefined) {
        throw new Error("sku missing for extra exception");
      }
      const orderId = id("44444444", opts.rngSeed + idx);
      const short = extra.shortPick === true;
      await insertOrderBundle(
        tx,
        opts.agencyId,
        {
          orderId,
          storeId: extra.storeId,
          warehouseId: opts.warehouseId,
          skuId,
          externalId: `EXC-${opts.rngSeed}-${idx}`,
          status: extra.status,
          placedAt: hoursAgo(extra.hoursInStatus),
          qtyOrdered: 4,
          qtyAllocated: extra.addressHold === true ? 0 : 4,
          qtyPicked: short ? 2 : extra.status === "PICKED" || extra.status === "PACKED" || extra.status === "STAGED" ? 4 : 0,
          qtyShipped: 0,
          tracking: null,
          exception: extra,
        },
        extra.missedCutoff === true ? "FedEx" : "UPS",
        "ground",
      );
      await insertException(
        tx,
        opts.agencyId,
        orderId,
        extra.key,
        extra.severity,
        extra.attributedTo,
        hoursAgo(Math.min(extra.hoursInStatus, 48)),
      );
      open += 1;
    }
  });
  return open;
}

async function countOpen(sql: Sql, agencyId: string): Promise<number> {
  return withTenant(sql, agencyId, async (tx) => {
    const rows = await tx<{ n: number }[]>`
      select count(*)::int as n from exceptions where status = 'open'
    `;
    return rows[0]?.n ?? 0;
  });
}

async function main(): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await wipeOperational(sql, [AGENCY_A, AGENCY_B]);
    await upsertOrg(sql);
    await upsertRules(sql, AGENCY_A, USER_OWNER_A);
    await upsertRules(sql, AGENCY_B, USER_OWNER_B);

    const skusA = await seedCutoffsAndCatalog(sql, AGENCY_A, WH_EWR, [STORE_HARBOR, STORE_PEAK], "16:00:00");
    const skusB = await seedCutoffsAndCatalog(sql, AGENCY_B, WH_LAX, [STORE_CINDER, STORE_LUMEN], "14:30:00");
    const harborSku = skusA[STORE_HARBOR]?.[0];
    const peakSku = skusA[STORE_PEAK]?.[0];
    if (harborSku === undefined || peakSku === undefined) {
      throw new Error("north skus missing");
    }

    const openA = await seedAgencyOrders(sql, {
      agencyId: AGENCY_A,
      warehouseId: WH_EWR,
      stores: [STORE_HARBOR, STORE_PEAK],
      skuIdsByStore: skusA,
      rngSeed: 101,
      healthyCount: 90,
      laggedSyncStoreId: STORE_HARBOR,
      freshSyncStoreId: STORE_PEAK,
      planted: plantedNorth(harborSku, peakSku),
      extraExceptions: [
        {
          storeId: STORE_PEAK,
          status: "BACKORDERED",
          key: "allocation_failure",
          severity: "critical",
          attributedTo: "merchant",
          hoursInStatus: 8,
        },
        {
          storeId: STORE_HARBOR,
          status: "PICKING",
          key: "short_pick",
          severity: "high",
          attributedTo: "warehouse",
          hoursInStatus: 3,
          shortPick: true,
        },
        {
          storeId: STORE_PEAK,
          status: "PICKED",
          key: "short_pick",
          severity: "high",
          attributedTo: "warehouse",
          hoursInStatus: 5,
          shortPick: true,
        },
        {
          storeId: STORE_HARBOR,
          status: "ON_HOLD",
          key: "address_validation_failure",
          severity: "high",
          attributedTo: "merchant",
          hoursInStatus: 10,
          addressHold: true,
        },
        {
          storeId: STORE_PEAK,
          status: "ON_HOLD",
          key: "address_validation_failure",
          severity: "high",
          attributedTo: "merchant",
          hoursInStatus: 14,
          addressHold: true,
        },
        {
          storeId: STORE_HARBOR,
          status: "PACKED",
          key: "missed_carrier_cutoff",
          severity: "critical",
          attributedTo: "warehouse",
          hoursInStatus: 20,
          missedCutoff: true,
        },
        {
          storeId: STORE_PEAK,
          status: "MANIFESTED",
          key: "missed_carrier_cutoff",
          severity: "critical",
          attributedTo: "warehouse",
          hoursInStatus: 18,
          missedCutoff: true,
        },
        {
          storeId: STORE_HARBOR,
          status: "ALLOCATED",
          key: "stuck_in_status",
          severity: "medium",
          attributedTo: "warehouse",
          hoursInStatus: 30,
        },
        {
          storeId: STORE_PEAK,
          status: "ALLOCATED",
          key: "stuck_in_status",
          severity: "medium",
          attributedTo: "warehouse",
          hoursInStatus: 26,
        },
        {
          storeId: STORE_HARBOR,
          status: "RELEASED",
          key: "stuck_in_status",
          severity: "medium",
          attributedTo: "warehouse",
          hoursInStatus: 16,
        },
        {
          storeId: STORE_HARBOR,
          status: "PICKING",
          key: "short_pick",
          severity: "high",
          attributedTo: "warehouse",
          hoursInStatus: 4,
          shortPick: true,
        },
        {
          storeId: STORE_PEAK,
          status: "STAGED",
          key: "missed_carrier_cutoff",
          severity: "critical",
          attributedTo: "warehouse",
          hoursInStatus: 22,
          missedCutoff: true,
        },
        {
          storeId: STORE_HARBOR,
          status: "ON_HOLD",
          key: "address_validation_failure",
          severity: "high",
          attributedTo: "merchant",
          hoursInStatus: 9,
          addressHold: true,
        },
        {
          storeId: STORE_PEAK,
          status: "PACKED",
          key: "stuck_in_status",
          severity: "medium",
          attributedTo: "warehouse",
          hoursInStatus: 11,
        },
        {
          storeId: STORE_HARBOR,
          status: "BACKORDERED",
          key: "allocation_failure",
          severity: "critical",
          attributedTo: "integration",
          hoursInStatus: 7,
        },
        {
          storeId: STORE_PEAK,
          status: "PICKING",
          key: "short_pick",
          severity: "high",
          attributedTo: "warehouse",
          hoursInStatus: 6,
          shortPick: true,
        },
        {
          storeId: STORE_HARBOR,
          status: "MANIFESTED",
          key: "missed_carrier_cutoff",
          severity: "critical",
          attributedTo: "warehouse",
          hoursInStatus: 15,
          missedCutoff: true,
        },
        {
          storeId: STORE_PEAK,
          status: "ALLOCATED",
          key: "stuck_in_status",
          severity: "medium",
          attributedTo: "warehouse",
          hoursInStatus: 28,
        },
      ],
    });

    const openB = await seedAgencyOrders(sql, {
      agencyId: AGENCY_B,
      warehouseId: WH_LAX,
      stores: [STORE_CINDER, STORE_LUMEN],
      skuIdsByStore: skusB,
      rngSeed: 202,
      healthyCount: 70,
      extraExceptions: [
        {
          storeId: STORE_CINDER,
          status: "PACKED",
          key: "stuck_in_status",
          severity: "medium",
          attributedTo: "warehouse",
          hoursInStatus: 12,
        },
        {
          storeId: STORE_LUMEN,
          status: "ON_HOLD",
          key: "address_validation_failure",
          severity: "high",
          attributedTo: "merchant",
          hoursInStatus: 8,
          addressHold: true,
        },
        {
          storeId: STORE_CINDER,
          status: "PICKING",
          key: "short_pick",
          severity: "high",
          attributedTo: "warehouse",
          hoursInStatus: 4,
          shortPick: true,
        },
        {
          storeId: STORE_LUMEN,
          status: "PACKED",
          key: "missed_carrier_cutoff",
          severity: "critical",
          attributedTo: "warehouse",
          hoursInStatus: 19,
          missedCutoff: true,
        },
        {
          storeId: STORE_CINDER,
          status: "ALLOCATED",
          key: "stuck_in_status",
          severity: "medium",
          attributedTo: "warehouse",
          hoursInStatus: 25,
        },
        {
          storeId: STORE_LUMEN,
          status: "BACKORDERED",
          key: "allocation_failure",
          severity: "critical",
          attributedTo: "merchant",
          hoursInStatus: 9,
        },
      ],
      planted: [],
    });

    const countedA = await countOpen(sql, AGENCY_A);
    const countedB = await countOpen(sql, AGENCY_B);
    const total = countedA + countedB;
    if (total < 20 || total > 40) {
      throw new Error(`Phase 2 check failed: open exceptions=${total} (agency A=${countedA}, B=${countedB}); want 20-40`);
    }
    console.log(
      `Phase 2 seed ok: open exceptions=${total} (A=${countedA} planted+extra=${openA}, B=${countedB} extra=${openB}); healthy orders mostly terminal over 60 days.`,
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
