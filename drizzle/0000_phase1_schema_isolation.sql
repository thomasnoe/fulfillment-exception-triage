CREATE TYPE "public"."attributed_to" AS ENUM('merchant', 'warehouse', 'carrier', 'integration');--> statement-breakpoint
CREATE TYPE "public"."exception_severity" AS ENUM('critical', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."exception_status" AS ENUM('open', 'assigned', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'manager', 'analyst', 'read_only');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('RECEIVED', 'VALIDATED', 'ON_HOLD', 'ALLOCATED', 'BACKORDERED', 'RELEASED', 'PICKING', 'PICKED', 'PACKED', 'MANIFESTED', 'STAGED', 'SHIPPED', 'PARTIALLY_SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "agencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agencies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"actor_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "carrier_cutoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"carrier" text NOT NULL,
	"service_level" text NOT NULL,
	"day_of_week" smallint NOT NULL,
	"cutoff_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carrier_cutoffs_warehouse_carrier_service_day" UNIQUE("warehouse_id","carrier","service_level","day_of_week")
);
--> statement-breakpoint
ALTER TABLE "carrier_cutoffs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exception_rule_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exception_rule_versions_rule_id_version" UNIQUE("rule_id","version")
);
--> statement-breakpoint
ALTER TABLE "exception_rule_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exception_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exception_rules_agency_id_key" UNIQUE("agency_id","key")
);
--> statement-breakpoint
ALTER TABLE "exception_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"rule_version_id" uuid NOT NULL,
	"severity" "exception_severity" NOT NULL,
	"attributed_to" "attributed_to" NOT NULL,
	"status" "exception_status" DEFAULT 'open' NOT NULL,
	"assignee_id" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exceptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"observed_on" date NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holidays_warehouse_id_observed_on" UNIQUE("warehouse_id","observed_on")
);
--> statement-breakpoint
ALTER TABLE "holidays" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"allocated" integer DEFAULT 0 NOT NULL,
	"held" integer DEFAULT 0 NOT NULL,
	"pending_disposition" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_sku_id_warehouse_id" UNIQUE("sku_id","warehouse_id")
);
--> statement-breakpoint
ALTER TABLE "inventory" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_syncs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_syncs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "memberships" (
	"user_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_id_agency_id" UNIQUE("user_id","agency_id")
);
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"qty_ordered" integer NOT NULL,
	"qty_allocated" integer DEFAULT 0 NOT NULL,
	"qty_picked" integer DEFAULT 0 NOT NULL,
	"qty_shipped" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"warehouse_id" uuid,
	"external_id" text NOT NULL,
	"status" "order_status" NOT NULL,
	"placed_at" timestamp with time zone NOT NULL,
	"carrier" text,
	"service_level" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_store_id_external_id" UNIQUE("store_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"dispositioned_at" timestamp with time zone,
	"disposition" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "returns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"carrier" text NOT NULL,
	"service_level" text NOT NULL,
	"tracking" text,
	"manifested_at" timestamp with time zone,
	"first_scan_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shipments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "skus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skus_store_id_external_id" UNIQUE("store_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "skus" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"name" text NOT NULL,
	"sync_interval_minutes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "warehouses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"signature" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_store_id_external_id" UNIQUE("store_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_cutoffs" ADD CONSTRAINT "carrier_cutoffs_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_cutoffs" ADD CONSTRAINT "carrier_cutoffs_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception_rule_versions" ADD CONSTRAINT "exception_rule_versions_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception_rule_versions" ADD CONSTRAINT "exception_rule_versions_rule_id_exception_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."exception_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception_rule_versions" ADD CONSTRAINT "exception_rule_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception_rules" ADD CONSTRAINT "exception_rules_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception_rules" ADD CONSTRAINT "exception_rules_current_version_id_exception_rule_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."exception_rule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_rule_version_id_exception_rule_versions_id_fk" FOREIGN KEY ("rule_version_id") REFERENCES "public"."exception_rule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_syncs" ADD CONSTRAINT "inventory_syncs_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_syncs" ADD CONSTRAINT "inventory_syncs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_sku_id_skus_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skus" ADD CONSTRAINT "skus_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "agencies_tenant_isolation" ON "agencies" AS PERMISSIVE FOR ALL TO public USING ("agencies"."id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid) WITH CHECK ("agencies"."id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid);--> statement-breakpoint
CREATE POLICY "audit_log_tenant_select" ON "audit_log" AS PERMISSIVE FOR SELECT TO public USING ("audit_log"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid);--> statement-breakpoint
CREATE POLICY "audit_log_tenant_insert" ON "audit_log" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("audit_log"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid);--> statement-breakpoint
CREATE POLICY "carrier_cutoffs_tenant_isolation" ON "carrier_cutoffs" AS PERMISSIVE FOR ALL TO public USING ("carrier_cutoffs"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid) WITH CHECK ("carrier_cutoffs"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid);--> statement-breakpoint
CREATE POLICY "exception_rule_versions_tenant_isolation" ON "exception_rule_versions" AS PERMISSIVE FOR ALL TO public USING ("exception_rule_versions"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid) WITH CHECK ("exception_rule_versions"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid);--> statement-breakpoint
CREATE POLICY "exception_rules_tenant_isolation" ON "exception_rules" AS PERMISSIVE FOR ALL TO public USING ("exception_rules"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid) WITH CHECK ("exception_rules"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid);--> statement-breakpoint
CREATE POLICY "exceptions_tenant_isolation" ON "exceptions" AS PERMISSIVE FOR ALL TO public USING ("exceptions"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid) WITH CHECK ("exceptions"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid);--> statement-breakpoint
CREATE POLICY "holidays_tenant_isolation" ON "holidays" AS PERMISSIVE FOR ALL TO public USING ("holidays"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid) WITH CHECK ("holidays"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid);--> statement-breakpoint
CREATE POLICY "inventory_tenant_isolation" ON "inventory" AS PERMISSIVE FOR ALL TO public USING ("inventory"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid) WITH CHECK ("inventory"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid);--> statement-breakpoint
CREATE POLICY "inventory_syncs_tenant_isolation" ON "inventory_syncs" AS PERMISSIVE FOR ALL TO public USING ("inventory_syncs"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid) WITH CHECK ("inventory_syncs"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid);--> statement-breakpoint
CREATE POLICY "memberships_tenant_isolation" ON "memberships" AS PERMISSIVE FOR ALL TO public USING ("memberships"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid) WITH CHECK ("memberships"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid);--> statement-breakpoint
CREATE POLICY "order_lines_tenant_isolation" ON "order_lines" AS PERMISSIVE FOR ALL TO public USING ("order_lines"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid) WITH CHECK ("order_lines"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid);--> statement-breakpoint
CREATE POLICY "orders_tenant_isolation" ON "orders" AS PERMISSIVE FOR ALL TO public USING ("orders"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid) WITH CHECK ("orders"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid);--> statement-breakpoint
CREATE POLICY "returns_tenant_isolation" ON "returns" AS PERMISSIVE FOR ALL TO public USING ("returns"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid) WITH CHECK ("returns"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid);--> statement-breakpoint
CREATE POLICY "shipments_tenant_isolation" ON "shipments" AS PERMISSIVE FOR ALL TO public USING ("shipments"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid) WITH CHECK ("shipments"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid);--> statement-breakpoint
CREATE POLICY "skus_tenant_isolation" ON "skus" AS PERMISSIVE FOR ALL TO public USING ("skus"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid) WITH CHECK ("skus"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid);--> statement-breakpoint
CREATE POLICY "stores_tenant_isolation" ON "stores" AS PERMISSIVE FOR ALL TO public USING ("stores"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid) WITH CHECK ("stores"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid);--> statement-breakpoint
CREATE POLICY "warehouses_tenant_isolation" ON "warehouses" AS PERMISSIVE FOR ALL TO public USING ("warehouses"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid) WITH CHECK ("warehouses"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid);--> statement-breakpoint
CREATE POLICY "webhook_events_tenant_isolation" ON "webhook_events" AS PERMISSIVE FOR ALL TO public USING ("webhook_events"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid) WITH CHECK ("webhook_events"."agency_id" = (nullif(current_setting('app.current_agency_id', true), ''))::uuid);--> statement-breakpoint
ALTER TABLE "agencies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stores" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "warehouses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "carrier_cutoffs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "holidays" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "skus" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_syncs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shipments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "returns" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "exception_rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "exception_rule_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "exceptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhook_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "audit_log" FROM PUBLIC;--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "exception_rule_versions" FROM PUBLIC;--> statement-breakpoint
DO $$ BEGIN
  EXECUTE format('REVOKE UPDATE, DELETE ON TABLE audit_log FROM %I', current_user);
  EXECUTE format('REVOKE UPDATE, DELETE ON TABLE exception_rule_versions FROM %I', current_user);
END $$;