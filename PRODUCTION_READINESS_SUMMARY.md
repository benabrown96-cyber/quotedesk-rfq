# Production-readiness implementation summary

Commit: `d56c4af3823d48316f79c5219edfe58c0eb54b61`

Deployed preview: deployed via `deploy_website` (asset id `a6f68786-37b1-4f7c-bea9-009f9f5762c6`).

## Files changed (12)

- `PRODUCTION_READINESS.md` — new authoritative doc covering implemented vs. infrastructure-pending items
- `shared/schema.ts` — `audit_events` table, granular permission columns, token-security columns, `expiresAt` on RFQ, `DEFAULT_CURRENCY`/`DEFAULT_RFQ_RESPONSE_BUSINESS_DAYS`/`AUDIT_EVENT_TYPES`/`ACTIVE_NEGOTIATION_STATUSES` constants
- `shared/roles.ts` — `resolveCommercialPermissions`, `PermCtx`, refreshed `RolePerms` (accepts boolean or context), new `canViewAuditTrail`/`canViewRfqAuditTrail`/`canManageInviteTokens`
- `shared/lib.ts` — new helpers: `formatUSD`, `addBusinessDays`, `defaultResponseDue`, `defaultTokenExpiry`, `businessDaysBetween`, `computeExpiryState`, `computeTokenState`
- `server/storage.ts` — table bootstrap + addColumn migrations, audit/event logging helpers, granular permission setters with legacy umbrella sync, token revoke/extend, `resolveInviteByToken` with state computation, USD-formatted notification bodies
- `server/routes.ts` — audit logging on RFQ/invite/quote/award/recommendation/document/user/token actions, granular permission enforcement, audit endpoints (`GET /api/audit-events`, RFQ-scoped), token control endpoints (`POST /api/invites/:id/token/{revoke,extend}`), portal returns 410 with friendly message when revoked/expired
- `client/src/components/audit-trail-panel.tsx` — new component (card + inline variants)
- `client/src/components/expiry-countdown.tsx` — new component (active/negotiating/expired badges)
- `client/src/components/user-directory.tsx` — three granular permission switches (Send RFQs, Negotiate, Recommend) per commercial-staff row, mobile-friendly column hiding
- `client/src/pages/home.tsx` — countdown badges in RFQ register and detail header, audit panels (global + RFQ-scoped), USD price labels with aria hints, mobile-responsive grid (`min-w-0` + `[&>*]:min-w-0`), responseDue can be left blank with default-window hint
- `client/src/pages/portal.tsx` — portal renders friendly "This portal link is no longer valid" page with the server's revoked/expired message
- `client/src/lib/queryClient.ts` — extracts server JSON `message` from error responses

## Tests run

- `npm run check` — passes (0 TypeScript errors)
- `npm run build` — passes (Vite + esbuild server bundle)
- API smoke tests via curl (live server on port 5000):
  - User directory shows seeded granular flags mirrored from legacy `commercialGrant`
  - `POST /api/rfqs` with no `responseDue` → server fills `responseDue` (5 business days) and `expiresAt`
  - Audit events generated for RFQ created and invite sent
  - `POST /api/invites/2/token/revoke` → portal returns HTTP 410 with revoked message
  - `POST /api/invites/2/token/extend` (3 business days) → portal returns 200
  - Granular permission denials: commercial staff with only `canSendRfqs=true` is correctly blocked from negotiate/recommendation routes
  - Audit access controls: buyer 403 on global, 200 on RFQ-scoped within their cluster; factory 403; subcontractor 403
- Playwright QA at 375px:
  - Login screen renders without overflow
  - Admin dashboard renders user directory with granular columns (provider hidden under md)
  - Global audit card visible to admin with all expected events
  - RFQ register entries show countdown badge ("5d 23h remaining" / "Default window: 5 business days")
  - RFQ detail header shows countdown alongside status
  - Portal renders normally on mobile; revoked token shows friendly error page

## Assumptions

- TEG operates from Sri Lanka (Asia/Colombo timezone). Business-day helper does not currently know about Sri Lanka public holidays — documented in `PRODUCTION_READINESS.md` as a follow-up.
- Existing seeded users with `commercialGrant=true` are auto-granted all three granular flags (`canSendRfqs`, `canNegotiate`, `canRecommendAwards`) by the seed mirror so behaviour is identical to before.
- "Active negotiation" pause uses statuses `under_negotiation`, `quoted`, `countered`, `responded` (the codebase uses `under_negotiation` and `quoted` today; the latter two are reserved for future state values).
- Portal token TTL defaults to the RFQ's `expiresAt` if present, otherwise 5 business days — same configurable constant.
- USD: stored prices remain integers (whole dollars); a future iteration can introduce minor units.

## Remaining external setup needed

The preview ships demo accounts and SQLite — production wiring is documented in `PRODUCTION_READINESS.md` and includes:

- **Postgres / Supabase / Azure SQL** (`DATABASE_URL`) — swap the Drizzle driver, run `drizzle-kit push`, one-time CSV export from SQLite
- **Object storage** (Azure Blob `AZURE_STORAGE_CONNECTION_STRING` + `AZURE_STORAGE_CONTAINER` or AWS S3 keys) — replace `rfq_documents.contentBase64` with bucket + key columns
- **Real email** (Microsoft Graph `MS_GRAPH_*` env vars or SendGrid `SENDGRID_API_KEY`) — wire side-effect into `notify*` methods after the in-app row is inserted
- **Real auth** (Microsoft Entra `AAD_TENANT_ID` / `AAD_CLIENT_ID` / `AAD_CLIENT_SECRET` + `SESSION_SECRET`) — replace the demo header system with verified id-tokens; lock `/api/users` to admin
- **Holiday calendar** for the business-day helper if production wants to skip Sri Lankan public holidays
