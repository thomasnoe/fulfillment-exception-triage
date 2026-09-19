# Fulfillment Exception Triage

Multi-tenant ops console. An agency manages several ecommerce client stores. The app ingests orders, auto-flags fulfillment exceptions against a versioned rules engine, and gives ops staff a triage queue to assign, resolve, and audit.

This file is persistent context for Claude Code. Read it before every task. If a decision here conflicts with something suggested mid-session, this file wins unless explicitly updated.

---

## 1. Why this exists

Portfolio demo for a company building internal tooling for agencies and ecommerce brands. One co-founder previously worked at a 3PL, so fake ops logic gets spotted instantly. The domain modeling matters as much as the code.

**What this demo is trying to prove, in order:**

1. Tenant isolation done at the data layer, not in components
2. Idempotent ingestion that survives webhook replay
3. Background work without dragging extra infrastructure into the stack
4. An append-only audit trail
5. Business rules as data, versioned, not hardcoded
6. Correct domain vocabulary and correct fault attribution

**Non-goals.** No billing. No customer-facing views. No real Shopify OAuth app. No websockets. No mobile layout. No dark mode toggle. No charting library. Three screens total, listed in section 9.

---

## 2. Stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node 24 | `@types/node@^24` must stay aligned |
| Framework | Next.js App Router | Server Components by default |
| Language | TypeScript, `strict: true` | No `any`, no `@ts-ignore`, no non-null `!` on external data |
| DB | Postgres | RLS enabled on all tenant tables |
| ORM | Drizzle + postgres.js | SQL stays readable, migrations checked into repo |
| Validation | zod | Every Server Action input, every webhook payload |
| Queue | pg-boss | Lives in Postgres, no Redis |
| Auth | Auth.js | Four roles, see section 8 |
| Tests | Vitest for rules, one Playwright path | Rules engine is the thing under test |

Do not add dependencies beyond this list without asking. Dependency sprawl in a demo repo reads as poor judgment.

---

## 3. Domain vocabulary

Use these terms in table names, enum values, UI labels, and commit messages. Wrong vocabulary is the fastest way to fail the credibility test with this audience.

| Term | Meaning |
|---|---|
| **Short pick** / UTF (unable to fill) | Picker finds less than expected at the pick face. Detected during picking. |
| **Short ship** | Shipment confirmed with fulfilled quantity below ordered quantity. The outcome. |
| **Allocation failure** | Order cannot reserve inventory. Surfaces to the merchant as an oversell. |
| **Oversell** | Merchant-side word for the same condition. Use in UI, use `allocation_failure` in code. |
| **Missed cutoff** / late dispatch | Order did not make the trailer. 3PL owned. |
| **Service failure** | Carrier missed its transit commitment. Carrier owned. |
| **Address correction** / UAA / RTS | Post-label address problems. Pre-label it is an address validation failure. |
| **Open order aging** / WIP aging | Orders sitting too long in a non-terminal status. |
| **Pending disposition** | Return physically received, not yet restocked, RTV'd, quarantined, or scrapped. |
| **IRA** | Inventory record accuracy, measured as absolute variance at location level. |
| **Dock-to-stock** | Hours from inbound arrival to inventory available to sell. |
| **ATP** | Available to promise. On hand minus allocated minus held minus pending disposition. |

Do not abbreviate address validation as AVS. AVS means Address Verification System in payments.

---

## 4. Order status enum

```
RECEIVED
VALIDATED
ON_HOLD
ALLOCATED
BACKORDERED
RELEASED
PICKING
PICKED
PACKED
MANIFESTED
STAGED
SHIPPED
PARTIALLY_SHIPPED
IN_TRANSIT
DELIVERED
CANCELLED
```

Terminal statuses: `SHIPPED`, `DELIVERED`, `CANCELLED`. Everything else can age.

The three handoffs where real orders die, and where the aging sweep must be sharpest:

- `ALLOCATED` with no pick task
- `PACKED` with no tracking number
- `SHIPPED` with no carrier acceptance scan

---

## 5. The six rules

Every exception row carries `attributed_to`. Severity alone is not enough, because the whole point is that these failures have different owners.

`attributed_to` enum: `merchant | warehouse | carrier | integration`

| Rule key | Trigger | attributed_to | Severity |
|---|---|---|---|
| `missed_carrier_cutoff` | Order not `STAGED` by the carrier cutoff for its warehouse, carrier, and service | warehouse | critical |
| `allocation_failure` | Order cannot fully allocate against ATP at release | merchant or integration, see below | critical |
| `address_validation_failure` | Address fails validation before label generation | merchant | high |
| `short_pick` | Pick task confirms quantity below allocated quantity | warehouse | high |
| `stuck_in_status` | Non-terminal status held past its per-status aging threshold | varies by status | medium, escalating |
| `return_pending_disposition` | Return received, no disposition recorded past threshold | warehouse | low |

**Attribution logic for `allocation_failure`.** This is the blame fight, model it honestly:

- Last inventory sync older than the store's sync interval, and the shortfall is within the delta → `integration`
- Sync current, physical count matches system, shortfall exists anyway → `merchant` (no channel buffer, demand across channels against one pool)
- Sync current, physical count differs from system → `warehouse` (cycle count variance)

**Severity model.** Score on four axes rather than assigning levels by feel. Document this in the README.

| Axis | Question |
|---|---|
| Blocking | Does it stop the shipment? |
| Customer-visible | Does the buyer already know something is wrong? |
| Reversible | Can ops fix it without contacting the customer? |
| Cost | Does it trigger a chargeback, reship, or refund? |

`stuck_in_status` escalates on a clock. An order in `PACKED` at 09:00 against a 15:00 cutoff is medium. The same order at 14:30 is critical. Escalation is computed, not stored.

**The chain worth writing about.** `return_pending_disposition` (low) causes cycle count variance, which causes `allocation_failure` (critical), which causes `short_pick` (high). A low-severity rule feeding two critical ones is the reason a boring rule earns a place in the engine.

---

## 6. Cutoff model

Four distinct clocks. They are separate fields, not one constant.

1. **Order cutoff.** Merchant-facing promise. Marketing number. Store-level.
2. **Release cutoff.** Last moment an order can drop to the floor and still make the truck. Derived: carrier cutoff minus pick, pack, and stage time.
3. **Pick deadline.** Per-order or per-wave.
4. **Carrier cutoff.** Physical trailer dispatch. Hard.

**Transit SLA is separate and starts at the first carrier acceptance scan, not at label creation.** This is why missing a cutoff by ten minutes costs a full day rather than ten minutes. It is a step function.

Storage requirements:

- Cutoffs keyed by `(warehouse_id, carrier, service_level, day_of_week)`
- IANA timezone on the warehouse, not a server-wide assumption
- A holiday calendar table
- No global `CUTOFF_HOUR` constant anywhere in the codebase

---

## 7. Data model

Sketch, not gospel. Adjust if a better shape emerges, but keep the tenant chain intact.

```
agencies
users
memberships          (user_id, agency_id, role)
stores               (agency_id, channel, sync_interval_minutes)
warehouses           (timezone)
carrier_cutoffs      (warehouse_id, carrier, service_level, day_of_week, cutoff_time)
holidays             (warehouse_id, date)

skus                 (store_id, external_id)
inventory            (sku_id, warehouse_id, on_hand, allocated, held, pending_disposition)
inventory_syncs      (store_id, synced_at, source)

orders               (store_id, external_id, status, placed_at, ...)
order_lines          (order_id, sku_id, qty_ordered, qty_allocated, qty_picked, qty_shipped)
shipments            (order_id, carrier, service_level, tracking, manifested_at, first_scan_at)
returns              (order_id, received_at, dispositioned_at, disposition)

exception_rules      (agency_id, key, enabled, current_version_id)
exception_rule_versions (rule_id, version, config jsonb, created_by, created_at)
exceptions           (order_id, rule_version_id, severity, attributed_to, status, assignee_id, opened_at, resolved_at, resolution_note)

audit_log            (agency_id, actor_id, entity_type, entity_id, action, before jsonb, after jsonb, reason, created_at)
webhook_events       (store_id, external_id, signature, payload, received_at)  -- unique on (store_id, external_id)
```

**Hard rules on this schema:**

- Every tenant table carries `agency_id` and has an RLS policy against a session variable such as `app.current_agency_id`
- `audit_log` is append-only. Revoke UPDATE and DELETE at the database level, not by convention
- `exception_rule_versions` is immutable. Editing a rule inserts a new version and repoints `current_version_id`
- `exceptions` references `rule_version_id`, never `rule_id`, so historical flags stay explainable after a rule changes

---

## 8. Roles

| Role | Can |
|---|---|
| `owner` | Everything, including rules admin and member management |
| `manager` | Triage, assign, resolve, edit rules |
| `analyst` | Triage, assign, resolve. No rules admin |
| `read_only` | View only |

Read-only must be genuinely read-only in the Server Action layer, not just hidden in the UI. Write a test that calls a mutation as `read_only` and asserts it is rejected.

---

## 9. Screens

Three. Nothing else ships.

1. **Exception queue.** Dense table. Filter by store, rule, severity, attribution, status, assignee. Sort by age against cutoff. Bulk assign and bulk resolve. Keyboard shortcuts for j/k navigation and assign.
2. **Exception detail.** Order context, rule that fired and which version, the audit timeline, resolve with a required reason.
3. **Rules admin.** List rules, edit config, see version history, diff between versions.

Freshness by 5 second poll or Postgres LISTEN/NOTIFY. Not websockets.

---

## 10. Build phases

Work top to bottom. Do not start a phase before the one above it passes its check.

Sections 1–9 stay stable. Sections 10–12 are the working surface: check boxes off as you go. Section 12 exists to stop the agent from quietly wrecking the demo (hardcoding rules, a global cutoff constant, mutating the audit log).

### Phase 0: environment
- [x] Postgres host: Neon, not Docker Compose. Local and dev use a real cloud Postgres, not a local container. RLS and pg-boss run in that same database
- [x] `.env.example` committed, `.env.local` gitignored
- [x] `drizzle.config.ts` wired, `npm run db:push` and `npm run db:studio` scripts added
- [x] Check: `npm run dev` serves, `db:studio` connects

### Phase 1: schema and isolation
- [x] Tables per section 7, migrations generated and committed
- [x] RLS policies on every tenant table
- [x] `audit_log` UPDATE and DELETE revoked
- [x] Check: a raw query without the session variable set returns zero rows

### Phase 2: seed
- [ ] Two agencies, four stores, two warehouses in different timezones
- [ ] 60 days of orders with realistic status distribution, most terminal
- [ ] Deliberate planted failures: a sync lag oversell, a count variance oversell, three orders packed with no tracking approaching cutoff, one return sitting 11 days undispositioned
- [ ] Check: queue has between 20 and 40 open exceptions, not 500

### Phase 3: ingestion
- [ ] Webhook route with HMAC verification
- [ ] Unique constraint on `(store_id, external_id)`, insert into `webhook_events` before processing
- [ ] Check: replay the same webhook 50 times in a script, assert order count does not move

### Phase 4: rules engine
- [ ] Pure functions, input is order state plus rule config, output is exception or null
- [ ] Config read from `exception_rule_versions.config`, nothing hardcoded
- [ ] Vitest coverage on all six rules including attribution branches for `allocation_failure`
- [ ] Check: tests pass, and changing a rule config in the DB changes behavior with no code edit

### Phase 5: workers
- [ ] pg-boss installed into the same database
- [ ] Aging sweep job, runs every minute, evaluates non-terminal orders
- [ ] Cutoff clock job, escalates `stuck_in_status` severity as cutoffs approach
- [ ] Check: advance a seeded order's clock, watch severity escalate without a restart

### Phase 6: queue screen
- [ ] Server Component table, filters in searchParams so views are shareable by URL
- [ ] Age-against-cutoff column, sortable, visually weighted
- [ ] Bulk actions through Server Actions with zod validation
- [ ] Check: every mutation writes an `audit_log` row

### Phase 7: detail screen
- [ ] Order and line context, rule version that fired
- [ ] Audit timeline
- [ ] Resolve flow with required reason
- [ ] Check: resolution reason appears in the timeline with actor and timestamp

### Phase 8: rules admin
- [ ] Edit creates a new version, never mutates
- [ ] Version history with diff
- [ ] Check: an exception opened under v1 still renders v1's config after v2 exists

### Phase 9: auth
- [ ] Auth.js with the four roles
- [ ] Session sets `app.current_agency_id` for RLS
- [ ] Check: read-only mutation attempt is rejected in the action layer, with a test proving it

### Phase 10: ship it
- [ ] README per section 11
- [ ] One Playwright test covering the triage happy path
- [ ] Seed script runs clean from an empty database in one command
- [ ] Two minute demo script written out, rehearsed

---

## 11. README requirements

The README is evaluated as heavily as the code. It must contain:

- The domain framing: why fulfillment exceptions and not a generic CRUD dashboard
- The six rules with their attribution logic, especially the three-way branch on `allocation_failure`
- The four-axis severity model
- The `return_pending_disposition` to `allocation_failure` to `short_pick` chain
- Why cutoffs are stored per warehouse, carrier, service, and day rather than as a constant, and why transit SLA starts at acceptance scan
- What was deliberately excluded and why. Name mis-pick and mis-ship specifically: they are only detectable post-ship through claims and returns, so they cannot drive a real-time queue
- A one-paragraph note that OTIF is deliberately not the headline metric, because it blends an inventory metric, a labor metric, and a carrier metric into one number and hides root cause. On-time ship rate, fill rate, and carrier service failure rate are reported separately by owner

---

## 12. Guardrails for Claude Code

- Do not hardcode exception logic. Rules live in the database as versioned config rows
- Do not introduce a global cutoff constant. Cutoffs are per warehouse, carrier, service, and day, in the warehouse timezone
- Do not use `any`, `@ts-ignore`, or non-null assertions on external data. Parse with zod at every boundary
- Do not mutate `exception_rule_versions` or `audit_log`. Both are append-only
- Do not add a fourth screen, a charting library, websockets, or Redis
- Do not scope-creep the seed data. Realistic beats large
- Every mutation writes an audit row in the same transaction as the change, not after it
- Write the Vitest case before the rule implementation, for all six rules
- When a phase check fails, stop and fix it. Do not proceed to the next phase with a red check
