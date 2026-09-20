/**
 * Phase 6 skeleton stands in for Auth.js (Phase 9).
 *
 * Northwind is the demo tenant. West Coast exists in seed so RLS has a foil —
 * do not add an agency switcher; that would be a fourth surface and an IDOR.
 *
 * TODO(thomas): session.agencyId + session.userId; reject read_only in actions.
 */
export const DEMO_AGENCY_ID = "a0000000-0000-4000-8000-000000000001";
export const DEMO_ACTOR_ID = "b0000000-0000-4000-8000-000000000001";
export const DEMO_AGENCY_NAME = "Northwind Fulfillment";
