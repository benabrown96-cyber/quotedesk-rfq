# Production readiness — what's implemented vs. what still needs infrastructure

This document is the single source of truth for what the RFQ preview ships with vs.
what TEG must wire up before going live. Every section calls out the demo behaviour,
the production target, and the environment variables / migration steps required.

> Last updated alongside the production-readiness implementation pass. See the commit
> message for the exact change set.

---

## 1. Audit trail — DONE

- **Schema:** `audit_events` table in `shared/schema.ts` (id, eventType, rfqId,
  inviteId, recommendationId, documentId, actorUserId, actorRole, actorLabel,
  action, summary, metadata JSON, createdAt). Auto-migrated on boot via
  `addColumn` / `CREATE TABLE IF NOT EXISTS` in `server/storage.ts`.
- **Events captured:** RFQ created, invite sent, quote / ETD submitted, buyer
  counter, recommendation submitted / decided, award approved, document
  uploaded / deleted, user grant changed, user active toggled, token revoked /
  extended.
- **API:** `GET /api/audit-events` and `GET /api/audit-events?rfqId=…&limit=…`.
- **UI:** `client/src/components/audit-trail-panel.tsx` exposes a card and an
  inline variant. Group admin sees a global "Recent audit events" card on the
  dashboard; group admin / buyer / commercial see an "RFQ audit history" card
  inside the selected RFQ. Factory and subcontractor users never see audit data.
- **Production note:** persists in the same database as the rest of the app,
  so swapping SQLite for Postgres (see §6) carries the audit trail with it.

## 2. USD currency — DONE

- All TEG transactions are USD (TEG operates as a Sri Lanka–based export
  company). `DEFAULT_CURRENCY = "USD"` in `shared/schema.ts`.
- Client and server both call `formatUSD()` from `shared/lib.ts`, e.g.
  `$1,234 USD`. Notification bodies (`server/storage.ts`) and price labels in
  `home.tsx` and `portal.tsx` use it.
- Form labels read "Counter price (USD)" and "Price (USD)"; inputs carry an
  `aria-describedby` hint reminding the user the value is in USD.
- Internal ETD-only flows still hide price entirely — the USD work does not
  change the price-visibility guard in `routes.ts`.

## 3. Granular commercial permissions — DONE

- New columns on `users`: `canSendRfqs`, `canNegotiate`, `canRecommendAwards`.
  Existing `commercialGrant` is preserved; `resolveCommercialPermissions` in
  `shared/roles.ts` falls back to "all three on" when only the legacy umbrella
  flag is set, so existing seeded users keep working.
- `RolePerms.canSendInvite`, `canEscalate`, `canBuyerNegotiate`,
  `canSubmitAwardRecommendation` now accept either the legacy boolean or a
  `PermCtx` object and consult the granular fields server-side and
  client-side.
- `PATCH /api/users/:id` accepts `canSendRfqs`, `canNegotiate`,
  `canRecommendAwards`. Each toggle generates an audit event.
- The user directory (admin only) renders three switches per commercial-staff
  row and is mobile-friendly (provider column collapses on narrow widths).
- Commercial staff can always create RFQs; only the granted capability is
  enabled. Server denials carry the specific message ("…need the 'Send RFQs'
  grant").

## 4. Token security — DONE

- `rfq_invites` gained `tokenExpiresAt`, `tokenRevokedAt`, `lastAccessedAt`,
  `accessCount`. New invites default `tokenExpiresAt` to the RFQ's `expiresAt`
  (or 1 calendar day / 24 hours if missing).
- `storage.resolveInviteByToken()` enforces revocation/expiry and bumps
  `lastAccessedAt` / `accessCount` on each successful read. `GET
  /api/portal/:token` returns `410 Gone` with a friendly message when revoked
  or expired (and the portal page surfaces it as "This portal link is no
  longer valid"). Active negotiation / awarded / closed invites remain
  reachable past the deadline.
- Admin-only `POST /api/invites/:id/token/revoke` and
  `POST /api/invites/:id/token/extend` (defaults to 1 extra calendar day / 24
  hours, matching the RFQ response window default).
- `computeTokenState` lives in `shared/lib.ts` so any future UI can render
  the same semantics.

## 5. RFQ expiry + countdown — DONE

- `DEFAULT_RFQ_RESPONSE_DAYS = 1` and `DEFAULT_RESPONSE_DAY_MODE = "calendar"`
  in `shared/schema.ts` — default response window is 1 calendar day (24 hours).
  Update these constants (or change the row in `system_settings` via the
  Platform Admin panel) to adjust the system-wide default. The legacy alias
  `DEFAULT_RFQ_RESPONSE_BUSINESS_DAYS` is kept for back-compat and now equals 1.
- `addBusinessDays`, `addCalendarDays`, `defaultResponseDue`,
  `businessDaysBetween`, and `computeExpiryState` in `shared/lib.ts` implement
  both calendar-day and business-day windows. Timezone is Asia/Colombo by
  assumption (TEG HQ); document holiday calendar handling before going live.
- `rfqs.expiresAt` is auto-populated by `createRfq` and back-filled for
  existing rows on startup.
- The dashboard renders `<RfqExpiryCountdown>` on each RFQ row and inside the
  detail header. States: active (badge with time remaining), negotiating
  ("Negotiation ongoing — expiry paused" while status is countered/quoted/
  responded/under_negotiation), and expired (rose badge).
- Manual extension/expiry: an admin can edit the `responseDue` (and therefore
  `expiresAt`) via direct SQL today; a UI affordance can be added later. The
  storage layer already has `extendInviteToken` for portal tokens.

## 6. Database — Postgres / Supabase / Azure SQL

- **Today:** SQLite via `better-sqlite3`, file path `data.db`. Single-process
  WAL mode. Fine for the preview, not safe for production multi-tenant load.
- **Recommended target:** Postgres (Supabase, Neon, or Azure Database for
  PostgreSQL). Drizzle's `drizzle-orm/postgres-js` driver is a drop-in for the
  current schema; only the runtime in `server/storage.ts` needs swapping.
- **Migration path:**
  1. Create the Postgres database; set `DATABASE_URL`.
  2. Replace `drizzle-orm/better-sqlite3` import with `postgres-js` and the
     `pg` schema helpers (the column types are identical in intent).
  3. Run `npx drizzle-kit push` (configuration already in
     `drizzle.config.ts`).
  4. One-time data export from SQLite → CSV → COPY into Postgres.
- **Required env vars:** `DATABASE_URL` (full Postgres URL), optional
  `SUPABASE_URL` + `SUPABASE_ANON_KEY` if proxying through Supabase.

## 7. File storage — Azure Blob / S3

- **Today:** PO + Pricing Quotation references are stored as base64 strings in
  the `rfq_documents.content_base64` column. Capped at 15 MB per upload.
- **Recommended target:** Azure Blob Storage (matches Microsoft 365 estate) or
  S3 with server-side encryption. Use signed URLs with a short TTL for
  download.
- **Migration path:**
  1. Provision a private container/bucket; lock public access; enable
     server-side encryption.
  2. Replace the `contentBase64` column with `storageBucket` +
     `storageObjectKey`. Leave the existing rows readable; lazy-migrate on
     download.
  3. Update `server/routes.ts` upload handler to stream to blob storage and
     persist only metadata.
- **Required env vars:** `AZURE_STORAGE_CONNECTION_STRING` +
  `AZURE_STORAGE_CONTAINER`, or `AWS_REGION` + `AWS_S3_BUCKET` +
  `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`.

## 8. Real email — Microsoft Graph / SMTP / SendGrid / SES

- **Today:** every "notification" is in-app. The `notifications` table is
  populated, the notification center renders it, but nothing leaves the
  process.
- **Recommended target:** Microsoft Graph (TEG already runs on
  theexpertsgroup.onmicrosoft.com). Fallback to SMTP / SendGrid / SES if a
  service principal cannot be provisioned.
- **Migration path:**
  1. Behind `notifyRfqSent` / `notifyQuoteReceived` / `notifyRecommendationPending` /
     `notifyAwardApproved`, add a side-effect that posts to the email
     provider after the in-app row is inserted. Use a queue (Azure Storage
     queues / SQS) so failures retry.
  2. Honor the audience scope: `subcontractor_invite` rows go to the
     subcontractor email; `factory` rows go to the factory mailbox;
     `admin_internal` and `admin_buyer_commercial` go to the corresponding
     internal distribution lists.
  3. Never include the portal token in plain text inside email logs;
     instead, embed a signed URL.
- **Required env vars:** Microsoft Graph — `MS_GRAPH_TENANT_ID`,
  `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`, `MS_GRAPH_FROM_ADDRESS`. Or
  SendGrid: `SENDGRID_API_KEY` + `SENDGRID_FROM`.

## 9. Auth — Microsoft Entra / Google OIDC

- **Today:** demo login picker; no token verification. Headers
  `x-rfq-user-id`, `x-rfq-role`, `x-rfq-scope-id`, `x-rfq-commercial-grant`
  drive identity. Inactive users are rejected; subcontractor users cannot hit
  dashboard routes.
- **Recommended target:** Microsoft Entra ID for staff
  (theexpertsgroup.onmicrosoft.com) + magic links for external subcontractors
  who do not have Entra accounts. See `AUTHENTICATION_SETUP.md` for the
  detailed wiring guide.
- **Required env vars:** `AAD_TENANT_ID`, `AAD_CLIENT_ID`, `AAD_CLIENT_SECRET`,
  plus `SESSION_SECRET` for the cookie session that replaces the demo
  headers.

## 10. Mobile accessibility — DONE for the production-readiness pass

- The dashboard already used `flex-wrap` / `grid` responsive classes; this pass
  added:
  - Provider column on the user directory now hides on narrow widths so the
    granular permission columns get room.
  - Every new toggle / countdown badge has an `aria-label`.
  - The countdown badge is keyboard-focusable (it's a `<Badge>` with text
    content, screen readers see the time remaining).
- Remaining manual pass (recommended before launch): run an axe-core audit and
  ensure all `<Input type="date">` controls render a native picker on iOS/
  Safari. The Playwright QA at 375px in this pass passed without overflow.

## Summary checklist

| Capability               | Status        | Required to go live                                                                                |
| ------------------------ | ------------- | -------------------------------------------------------------------------------------------------- |
| Audit trail              | Done          | —                                                                                                  |
| USD currency             | Done          | —                                                                                                  |
| Granular commercial perms | Done          | —                                                                                                  |
| Token expiry / revoke    | Done          | —                                                                                                  |
| RFQ countdown / expiry   | Done          | Confirm 5-business-day default with TEG; wire holiday calendar.                                    |
| Mobile accessibility     | Improved      | Run axe / lighthouse audit; final QA on iOS Safari.                                                |
| Database (Postgres)      | **Pending**   | Provision DB, set `DATABASE_URL`, switch driver, migrate.                                          |
| Object storage           | **Pending**   | Provision bucket / container, set credentials, lazy-migrate base64 rows.                           |
| Real email               | **Pending**   | Provision Graph app or SendGrid, wire side-effect into `notify*` methods.                          |
| Auth (Entra / OIDC)      | **Pending**   | Replace demo headers with real session; lock `/api/users` to admin per AUTHENTICATION_SETUP.md.    |
