CREATE ROLE fulfillment_app;--> statement-breakpoint
ALTER ROLE fulfillment_app WITH NOLOGIN NOBYPASSRLS;--> statement-breakpoint
GRANT fulfillment_app TO CURRENT_USER;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO fulfillment_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fulfillment_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fulfillment_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE audit_log FROM fulfillment_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE exception_rule_versions FROM fulfillment_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fulfillment_app;