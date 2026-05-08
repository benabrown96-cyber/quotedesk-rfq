# RFQ Roles & Permissions — Implementation Summary

## Status: Complete

- TypeScript check: pass
- Production build: pass
- Browser QA across 4 roles + portal scenarios: pass
- API permission enforcement: pass (curl tests)
- Deployed: https://www.perplexity.ai/computer/a/rfq-system-pvaHhjexT3y.qQCfn1dixg
- Asset id: `a6f68786-37b1-4f7c-bea9-009f9f5762c6`
- Commit hash: `3f65e02fbc2df3e9ccc80c605a9193a7fc88b2d4`
- Commit message: "Add role-based permissions: group admin, buyer, factory user, subcontractor"

## Roles delivered

| Role                | Dashboard | Create RFQ | Manage subs | Send invites | Escalate | Sees price | Negotiate |
|---------------------|-----------|------------|-------------|--------------|----------|------------|-----------|
| group_admin         | full      | yes        | yes         | yes          | yes      | yes        | buyer-side |
| buyer               | full      | yes        | yes         | yes          | yes      | yes (external only) | buyer-side |
| factory_user        | factory queue only | no | no | no | no | never (always hidden) | ETD-only |
| subcontractor_user  | blocked   | no         | no          | no           | no       | only via portal token | only via portal |

Buyer default scope = company 1 (Tropicoir Lanka). Factory default scope = factory 2 (Premier Tech Palai).

## Architecture

- **No localStorage / sessionStorage / cookies.** Role state lives in React context plus a module-level snapshot consumed by the query client.
- Role + scope sent on every API request via headers `x-rfq-role` and `x-rfq-scope-id`.
- Server middleware `attachRole` validates role + applies enforcement.

## Files

### Created
- `shared/roles.ts` — Role types, `ROLE_HEADER`, `SCOPE_HEADER`, `ROLE_PERSONAS`, `RolePerms` predicates, `isValidRole`.
- `client/src/lib/role-context.tsx` — `RoleProvider`, `useRole` hook, `getCurrentRoleHeaders()` for non-React callers.
- `client/src/components/role-switcher.tsx` — In-app role + scope picker with permission badges.

### Modified
- `client/src/App.tsx` — Wrapped tree with `RoleProvider`; subcontractor sees blocked page; topbar shows active role.
- `client/src/lib/queryClient.ts` — `apiRequest` and default `queryFn` inject role headers.
- `client/src/pages/home.tsx` — Permission-gated controls; `FactoryControls` ETD-only form; price hidden for factory users; factory-scope banner; empty state.
- `client/src/pages/portal.tsx` — `banner-session-kind` indicates Internal ETD-only vs External commercial session.
- `server/routes.ts` — `attachRole` middleware; subcontractor blocked from non-portal endpoints; permission checks on RFQ/invite/negotiation routes; factory_user RFQ list filtered by their factory and prices stripped from response.
- `server/storage.ts` — Added `getInviteById()` and `rfqIdsForFactory()`.

## QA evidence

- `/tmp/qa-admin.png`, `/tmp/qa-buyer.png`, `/tmp/qa-factory.png`, `/tmp/qa-subcontractor.png`
- `/tmp/qa-portal-internal.png`, `/tmp/qa-portal-external.png`

### Browser checks (all passed)
- group_admin: shows create-rfq + add-subcontractor cards + send-invites region
- buyer: same as admin (scoped to company 1)
- factory_user: createRfq=0, addSub=0, sendInvites=0, banner-factory-scope=1, page-factory-dashboard=1, factory forms visible, "Price hidden" labels visible
- subcontractor_user: page-subcontractor-blocked rendered
- Portal internal token: banner reads "Internal ETD-only session — pricing is intentionally hidden"
- Portal external token: banner reads "External commercial quotation session — price + ETD"

### API enforcement (curl)
- `factory_user` GET /api/rfqs → only their factory's RFQs (price stripped)
- `subcontractor_user` GET /api/rfqs → 403 "may only use their tokenized portal link"
- `factory_user` POST /api/rfqs → 403 "Only buyers and group admins can create RFQs"
- buyer POST price on hidden invite → 403 "Price is not allowed on internal ETD-only invites"
- factory_user wrong scope → 403 "may only respond to invites for their factory"
- factory_user correct scope → 201 created (ETD-only quote)

## Test IDs added
Role switcher: `card-role-switcher`, `select-role`, `option-role-<role>`, `select-role-scope`, `list-role-permissions`
Active label: `text-active-role`
Page roots: `page-internal-dashboard`, `page-factory-dashboard`, `page-subcontractor-blocked`, `page-internal-portal`, `page-subcontractor-portal`
Gated regions: `card-create-rfq`, `card-add-subcontractor`, `region-send-invites`, `card-rfq-register`, `banner-factory-scope`
Factory controls: `form-factory-response-<id>`, `input-factory-etd-<id>`, `textarea-factory-note-<id>`, `button-factory-submit-<id>`, `button-factory-accept-<id>`, `button-factory-decline-<id>`, `text-factory-no-price-<id>`
Portal: `banner-session-kind`
