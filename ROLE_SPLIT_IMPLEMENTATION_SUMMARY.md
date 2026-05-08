# Role split + shared subcontractors — implementation summary

Commit hash: `ae7916a` (parent `d56c4af`)
Branch: `main` (project default)

Deployed preview asset id: `a6f68786-37b1-4f7c-bea9-009f9f5762c6`

## What changed

### 1. Roles & permissions
- Split the legacy `group_admin` into:
  - `senior_management` — final business authority (award approvals, recommendation decisions, PO/Pricing-Quotation reference docs, awards, settings, user mgmt).
  - `platform_admin` — IT / settings support (manages users, role assignments, active state, system settings, portal token revoke/extend, full audit). Explicitly blocked from approving awards, deciding recommendations, accepting/declining/awarding, and reading reference documents.
- Added optional `commercial_manager` (cluster-scoped) — sees all RFQs in the cluster, can grant commercial-staff permissions in the cluster, can negotiate / send invites, but cannot finalise an award and cannot decide a recommendation.
- `group_admin` kept as a back-compat alias of Senior Management; existing rows continue to work, but the UI never renders the "TEG admin" label.

Single source of truth in `shared/roles.ts`:
- `ROLES` enum, `BUSINESS_APPROVAL_ROLES`, `isBusinessApprover`, `isPlatformAdmin`.
- `RolePerms` extended: `canEditSystemSettings`, `canManageUsers`, `canManageCommercialPermissions`, `canAssignRole`, `canEditSubcontractorClusterAccess`, `canViewReferenceDocuments`, etc.
- `isSubcontractorAvailableForCluster(list, requestingCluster)` for cluster-availability checks.

### 2. Schema additions
- `subcontractors.cluster_access` (TEXT, JSON-encoded array, default `'[]'`). Empty = both clusters.
- `system_settings` table with `responseDefaultDays`, `responseDayMode` (`business` | `calendar`), `updatedAt`, `updatedBy`.
- Insert/update Zod schemas: `updateSubcontractorClusterAccessSchema`, `updateSettingsSchema`.
- Audit events added: `user_role_changed`, `settings_changed`, `subcontractor_cluster_access_changed`.

### 3. Storage
- `getSettings()` / `updateSettings(patch, updatedBy)` plus boot-time row creation.
- `setSubcontractorClusterAccess(id, clusters)`.
- `setUserRole(id, role)`.
- `inviteRecipient` now enforces, in order: country routing (India under Growrite blocked) → subcontractor cluster availability. Country rules win and cannot be overridden by cluster availability.
- `createRfq` reads system settings to compute `responseDue` honouring days + day-mode.
- Seed data: Senior Mgmt (Priya), Platform Admin (Indira), Commercial Manager (Suresh), plus a second Senior Mgmt seat (Sanjeewa). Idempotent migration ensures these users exist on existing DBs.
- New shared subcontractor seed: `Atlas` (both clusters, empty list), `Lanka Pallet Works` (both clusters, explicit), `CocoLine India` (Euro/Growrite only), `Nusa` (Tropicoir/Premier Tech only).

### 4. Routes
- `GET /api/settings`, `PATCH /api/settings` — guarded by `canEditSystemSettings` (SM or PA).
- `PATCH /api/subcontractors/:id/cluster-access` — guarded by `canEditSubcontractorClusterAccess` (SM or PA), audited.
- `GET /api/subcontractors` filters by sender cluster for cluster-scoped roles; SM/PA see all.
- `POST /api/users/:id` accepts `role` plus existing `active`, `commercialGrant`, granular flags. Role assignment audited.
- `POST /api/rfqs/:id/award` and document endpoints explicitly block Platform Admin and Commercial Manager.
- `GET /api/rfqs` filters Commercial Manager scope to whole cluster; Buyer / Commercial Staff see their company's cluster as before.

### 5. Client
- `client/src/lib/role-labels.ts` — central role icon/label/short-label/access-description map. No "TEG admin" text anywhere.
- New components:
  - `your-access-card.tsx` — visible scope badges (role, cluster, company, factory, scope-type) for the signed-in user.
  - `system-settings-panel.tsx` — SM / PA edit response window + day mode.
  - `subcontractor-cluster-access.tsx` — SM / PA toggle cluster availability; "Both clusters" rendered when list is empty.
- `user-directory.tsx` adds a per-row role-assign dropdown and now uses `RolePerms.canManageUsers` (so Platform Admin sees it too).
- `home.tsx`: `isAdmin = senior_management | group_admin`; new banners; subcontractor pickers show cluster-availability tag; create-RFQ form pulls the configurable response window from `/api/settings`.
- `expiry-countdown.tsx` reads `/api/settings` and shows e.g. `Default window: 5 calendar days`.
- `role-context.tsx` default role is now `senior_management` (replaces `group_admin`).

### 6. Tests / QA executed
- `npm run check` (tsc) — clean.
- `npm run build` (Vite + esbuild) — clean (only the existing chunk-size advisory).
- API tests via curl:
  - Platform Admin awarding → 403 (`Only Senior Management or buyers can finalise an award.`)
  - Platform Admin reading docs → 403 (Reference documents restricted to Senior Management).
  - Senior Mgmt reading docs → 200.
  - Platform Admin editing settings → 200 (`responseDayMode` switches to calendar; new RFQ deadline lands on +N calendar days).
  - Commercial Staff editing settings → 403.
  - Cluster-aware `/api/subcontractors`: Tropicoir Commercial sees Atlas + Nusa + Lanka Pallet (no CocoLine India). Euro Commercial sees Atlas + CocoLine + Lanka Pallet (no Nusa).
  - Inviting CocoLine India under Growrite (GRT) → 422 with India-routing message.
  - Inviting Nusa (Tropicoir-only) under Growrite → 422 with cluster-availability message.
  - Inviting Atlas (both) and Lanka Pallet (both, explicit) under Growrite → 201.
  - Setting back to 5 business days → new RFQ responseDue lands on 2026-05-11 (Mon→Mon, weekend skipped).
- Playwright UI smoke (1280×900 + 375 mobile):
  - Login screen renders Senior Management, Platform Admin, Commercial Manager, Buyer, Commercial Staff, Factory User, Subcontractor cards. Each card carries a `Your access:` summary. Zero matches for "TEG admin".
  - Senior Management dashboard: Your-access card, User directory with assign-role dropdown, System settings, Subcontractor cluster availability all visible.
  - Platform Admin dashboard: same set of admin panels, but routes that need approval power return 403.
  - Commercial Manager dashboard: Your-access card shows `Commercial oversight: Tropicoir / Premier Tech cluster`. No User directory / settings / cluster-access cards.
  - Commercial Staff: scope label shows the cluster as expected.
  - Mobile (375): layout stacks correctly.
- Screenshots saved to repository: `qa-1-login.png` … `qa-6-mobile-sm.png`.

### 7. Deployment
- Production server started via `node dist/index.cjs` on port 5000.
- `deploy_website` uploaded `dist/public` and returned a preview URL (asset id `a6f68786-37b1-4f7c-bea9-009f9f5762c6`).

### 8. Files changed
```
shared/schema.ts
shared/roles.ts
shared/lib.ts
server/storage.ts
server/routes.ts
client/src/App.tsx (no change — header inherits new persona labels)
client/src/lib/role-context.tsx
client/src/lib/role-labels.ts                       (new)
client/src/components/account-switcher.tsx
client/src/components/audit-trail-panel.tsx
client/src/components/award-recommendations.tsx
client/src/components/expiry-countdown.tsx
client/src/components/login-panel.tsx
client/src/components/role-switcher.tsx              (legacy demo helper, rewired)
client/src/components/system-settings-panel.tsx     (new)
client/src/components/subcontractor-cluster-access.tsx (new)
client/src/components/your-access-card.tsx          (new)
client/src/components/user-directory.tsx
client/src/pages/home.tsx
ROLE_SPLIT_IMPLEMENTATION_SUMMARY.md                (this file)
```

### 9. Assumptions
- "Senior Management" and the legacy "Group admin / TEG Admin" share the same authority. `group_admin` users created earlier keep working without manual migration.
- Empty `clusterAccess` list = available to BOTH clusters (legacy default for any pre-existing rows).
- Country routing rules (e.g. India under Growrite is blocked) **always** apply on top of cluster availability, never below it.
- Commercial Manager is intentionally not a final-award role. They can grant commercial-staff permissions and negotiate, but final award still requires Senior Management or the buyer.
- Platform Admin specifically has **no** access to PO / Pricing Quotation reference documents. If Senior Management ever wants to grant PA the doc role, they would explicitly assign that role — there is no implicit IT bypass.
- The configurable response window stores days + mode; existing RFQs keep their original deadline.
- Demo seeded second Senior Mgmt user (Sanjeewa) lets reviewers test the "another approver must review" guard on recommendations.

### 10. How role assignment guarantees section access for a specific person
A signed-in user's record carries:
- `role` — the categorical permission (Senior Management, Platform Admin, Commercial Manager, Buyer, Commercial Staff, Factory User, Subcontractor).
- `scopeType` ∈ {`none`, `company`, `factory`, `subcontractor`, `cluster`}.
- `scopeId`, `companyId`, `factoryId`, `subcontractorId`, `clusterName` — the specific anchor for that scope.

Every API request includes `x-rfq-user-id`. The Express `attachRole` middleware loads that user from the DB and overwrites `req.role / req.scopeId / req.user`. The same data backs the client's "Your access" card, so the user sees exactly the badges that reflect what the server will enforce.

Each route then runs the role through `RolePerms` predicates plus the scope filter. Examples:
- `GET /api/rfqs` returns only the RFQs whose `requestingCompanyId` is in the user's cluster (for Buyer / Commercial Staff / Commercial Manager via `companies` lookup) or all (for SM / PA). Factory users are limited to RFQs that have an invite assigned to their factory.
- `GET /api/subcontractors` removes any subcontractor whose `clusterAccess` does not include the user's cluster (cluster-scoped roles only). SM / PA see everything; factory users see nothing.
- `POST /api/rfqs/:id/award` and the document endpoints reject Platform Admin and Commercial Manager outright via `RolePerms.canAcceptOrAward` / `canViewReferenceDocuments`.
- `PATCH /api/settings` and `PATCH /api/subcontractors/:id/cluster-access` reject any role that is not Senior Management or Platform Admin.
- The Commercial Manager grant path further checks `req.user.scopeId === target.companyId`, so a CM cannot grant permissions outside their own cluster.

The UI mirrors these checks (`RolePerms.canManageUsers`, `canEditSystemSettings`, `canViewReferenceDocuments`, etc.) so unrelated cards never appear, but the server is the source of truth — even if a client tampered with rendering, the API would still 403. Role + scope are derived from the authoritative `users` row, never from headers, so a user can only access the section their assigned role + scope authorise.
