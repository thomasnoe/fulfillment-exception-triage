import { sql, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const membershipRole = pgEnum("membership_role", [
  "owner",
  "manager",
  "analyst",
  "read_only",
]);

export const orderStatus = pgEnum("order_status", [
  "RECEIVED",
  "VALIDATED",
  "ON_HOLD",
  "ALLOCATED",
  "BACKORDERED",
  "RELEASED",
  "PICKING",
  "PICKED",
  "PACKED",
  "MANIFESTED",
  "STAGED",
  "SHIPPED",
  "PARTIALLY_SHIPPED",
  "IN_TRANSIT",
  "DELIVERED",
  "CANCELLED",
]);

export const attributedTo = pgEnum("attributed_to", [
  "merchant",
  "warehouse",
  "carrier",
  "integration",
]);

export const exceptionSeverity = pgEnum("exception_severity", [
  "critical",
  "high",
  "medium",
  "low",
]);

export const exceptionStatus = pgEnum("exception_status", [
  "open",
  "assigned",
  "resolved",
]);

function matchesCurrentAgency(column: AnyPgColumn): SQL {
  return sql`${column} = (nullif(current_setting('app.current_agency_id', true), ''))::uuid`;
}

function tenantIsolation(policyName: string, column: AnyPgColumn) {
  const match = matchesCurrentAgency(column);
  return pgPolicy(policyName, {
    as: "permissive",
    for: "all",
    to: "public",
    using: match,
    withCheck: match,
  });
}

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
};

export const agencies = pgTable(
  "agencies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    ...timestamps,
  },
  (table) => [tenantIsolation("agencies_tenant_isolation", table.id)],
).enableRLS();

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  ...timestamps,
});

export const memberships = pgTable(
  "memberships",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id),
    role: membershipRole("role").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("memberships_user_id_agency_id").on(table.userId, table.agencyId),
    tenantIsolation("memberships_tenant_isolation", table.agencyId),
  ],
).enableRLS();

export const stores = pgTable(
  "stores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id),
    channel: text("channel").notNull(),
    name: text("name").notNull(),
    syncIntervalMinutes: integer("sync_interval_minutes").notNull(),
    ...timestamps,
  },
  (table) => [tenantIsolation("stores_tenant_isolation", table.agencyId)],
).enableRLS();

export const warehouses = pgTable(
  "warehouses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    ...timestamps,
  },
  (table) => [tenantIsolation("warehouses_tenant_isolation", table.agencyId)],
).enableRLS();

export const carrierCutoffs = pgTable(
  "carrier_cutoffs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    carrier: text("carrier").notNull(),
    serviceLevel: text("service_level").notNull(),
    dayOfWeek: smallint("day_of_week").notNull(),
    cutoffTime: time("cutoff_time").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("carrier_cutoffs_warehouse_carrier_service_day").on(
      table.warehouseId,
      table.carrier,
      table.serviceLevel,
      table.dayOfWeek,
    ),
    tenantIsolation("carrier_cutoffs_tenant_isolation", table.agencyId),
  ],
).enableRLS();

export const holidays = pgTable(
  "holidays",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    observedOn: date("observed_on").notNull(),
    name: text("name").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("holidays_warehouse_id_observed_on").on(table.warehouseId, table.observedOn),
    tenantIsolation("holidays_tenant_isolation", table.agencyId),
  ],
).enableRLS();

export const skus = pgTable(
  "skus",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    externalId: text("external_id").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("skus_store_id_external_id").on(table.storeId, table.externalId),
    tenantIsolation("skus_tenant_isolation", table.agencyId),
  ],
).enableRLS();

export const inventory = pgTable(
  "inventory",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id),
    skuId: uuid("sku_id")
      .notNull()
      .references(() => skus.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    onHand: integer("on_hand").notNull().default(0),
    allocated: integer("allocated").notNull().default(0),
    held: integer("held").notNull().default(0),
    pendingDisposition: integer("pending_disposition").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    unique("inventory_sku_id_warehouse_id").on(table.skuId, table.warehouseId),
    tenantIsolation("inventory_tenant_isolation", table.agencyId),
  ],
).enableRLS();

export const inventorySyncs = pgTable(
  "inventory_syncs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
    source: text("source").notNull(),
    ...timestamps,
  },
  (table) => [tenantIsolation("inventory_syncs_tenant_isolation", table.agencyId)],
).enableRLS();

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    warehouseId: uuid("warehouse_id").references(() => warehouses.id),
    externalId: text("external_id").notNull(),
    status: orderStatus("status").notNull(),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull(),
    carrier: text("carrier"),
    serviceLevel: text("service_level"),
    ...timestamps,
  },
  (table) => [
    unique("orders_store_id_external_id").on(table.storeId, table.externalId),
    tenantIsolation("orders_tenant_isolation", table.agencyId),
  ],
).enableRLS();

export const orderLines = pgTable(
  "order_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    skuId: uuid("sku_id")
      .notNull()
      .references(() => skus.id),
    qtyOrdered: integer("qty_ordered").notNull(),
    qtyAllocated: integer("qty_allocated").notNull().default(0),
    qtyPicked: integer("qty_picked").notNull().default(0),
    qtyShipped: integer("qty_shipped").notNull().default(0),
    ...timestamps,
  },
  (table) => [tenantIsolation("order_lines_tenant_isolation", table.agencyId)],
).enableRLS();

export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    carrier: text("carrier").notNull(),
    serviceLevel: text("service_level").notNull(),
    tracking: text("tracking"),
    manifestedAt: timestamp("manifested_at", { withTimezone: true }),
    firstScanAt: timestamp("first_scan_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [tenantIsolation("shipments_tenant_isolation", table.agencyId)],
).enableRLS();

export const returns = pgTable(
  "returns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    dispositionedAt: timestamp("dispositioned_at", { withTimezone: true }),
    disposition: text("disposition"),
    ...timestamps,
  },
  (table) => [tenantIsolation("returns_tenant_isolation", table.agencyId)],
).enableRLS();

export const exceptionRules = pgTable(
  "exception_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id),
    key: text("key").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    currentVersionId: uuid("current_version_id").references(() => exceptionRuleVersions.id),
    ...timestamps,
  },
  (table) => [
    unique("exception_rules_agency_id_key").on(table.agencyId, table.key),
    tenantIsolation("exception_rules_tenant_isolation", table.agencyId),
  ],
).enableRLS();

export const exceptionRuleVersions = pgTable(
  "exception_rule_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => exceptionRules.id),
    version: integer("version").notNull(),
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("exception_rule_versions_rule_id_version").on(table.ruleId, table.version),
    tenantIsolation("exception_rule_versions_tenant_isolation", table.agencyId),
  ],
).enableRLS();

export const exceptions = pgTable(
  "exceptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    ruleVersionId: uuid("rule_version_id")
      .notNull()
      .references(() => exceptionRuleVersions.id),
    severity: exceptionSeverity("severity").notNull(),
    attributedTo: attributedTo("attributed_to").notNull(),
    status: exceptionStatus("status").notNull().default("open"),
    assigneeId: uuid("assignee_id").references(() => users.id),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    ...timestamps,
  },
  (table) => [tenantIsolation("exceptions_tenant_isolation", table.agencyId)],
).enableRLS();

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id),
    actorId: uuid("actor_id").references(() => users.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => {
    const match = matchesCurrentAgency(table.agencyId);
    return [
      pgPolicy("audit_log_tenant_select", {
        as: "permissive",
        for: "select",
        to: "public",
        using: match,
      }),
      pgPolicy("audit_log_tenant_insert", {
        as: "permissive",
        for: "insert",
        to: "public",
        withCheck: match,
      }),
    ];
  },
).enableRLS();

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    externalId: text("external_id").notNull(),
    signature: text("signature").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("webhook_events_store_id_external_id").on(table.storeId, table.externalId),
    tenantIsolation("webhook_events_tenant_isolation", table.agencyId),
  ],
).enableRLS();
