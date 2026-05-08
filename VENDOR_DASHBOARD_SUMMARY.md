# Subcontractor Restricted Dashboard — Final Summary

## Status
COMPLETE. Implementation, build, type-check, API security tests, desktop + mobile Playwright QA, deploy, and commit all done.

## Commit
- Hash: `e103d74` (short) / `e103d74800cc811d9ad9e9919656ed1b76238400`
- Title: `feat: restricted authenticated vendor dashboard for subcontractor users`
- Parent: `f5ba79b`

## Deploy
- URL: https://www.perplexity.ai/computer/a/rfq-system-pvaHhjexT3y.qQCfn1dixg
- Built bundle: `dist/public/{index.html, assets/index-A_DNt8bv.css, assets/index-DPxisgRm.js}`

## Changed Files (9 total in commit)
- `server/routes.ts` (+95 / -??) — allow-list middleware moved before route handlers; filtered GET /api/rfqs and GET /api/rfqs/:id for vendors.
- `server/storage.ts` (+16) — `rfqIdsForSubcontractor()` added to IStorage + DrizzleStorage.
- `shared/roles.ts` (+19 / -??) — `RolePerms.canViewDashboard` true for all roles; subcontractor_user persona label/description updated.
- `client/src/App.tsx` (+75 / -??) — `VendorShell` replaces SubcontractorBlocked; subcontractor_user route → VendorDashboard.
- `client/src/pages/vendor-dashboard.tsx` (NEW, 318 lines) — `data-testid="page-vendor-dashboard"`, restricted RFQ cards, portal-link buttons, loading/empty/error states.
- `qa-vendor-1-login.png`, `qa-vendor-2-dashboard.png`, `qa-vendor-3-mobile.png`, `qa-internal-1-senior.png` — QA screenshots.

## Vendor Allow-List
All other `/api/*` paths return 403 with: "Vendor users only have access to their own assigned RFQs and the portal response link."
- `GET /api/me`
- `/api/portal/*` (token-based, also works without auth)
- `GET /api/rfqs` — filtered to `rfqIdsForSubcontractor(user.subcontractorId)`
- `GET /api/rfqs/:digits` — sanitized: invites filtered to own only; PO context (partnerClient, poCountry, poCustomerName, escalationReason) and producingCompany/producingFactory nulled. 403 if no own invite.

## API Security Verification (curl tests)
| Path | senior_management (id=1) | vendor (id=8) |
|---|---|---|
| `/api/me` | 200 | 200 |
| `/api/rfqs` | 3 RFQs | 1 RFQ (own only) |
| `/api/rfqs/2` | 200, 2 invites, full PO data | 200, 1 own invite, sanitized |
| `/api/users` | 200 | 403 |
| `/api/settings` | 200 | 403 |
| `/api/subcontractors` | 200 | 403 |
| `/api/companies`, `/api/factories`, `/api/audit-events`, `/api/notifications` | 200 | 403 |
| `/api/rfqs/2/documents` | 200 | 403 |
| `/api/rfqs/2/recommendations` | 200 | 403 |
| `/api/rfqs/2/amendments` | 200 | 403 |
| `POST /api/rfqs` | 200 | 403 |
| `POST /api/invites/1/negotiations` | 200 | 403 |
| `/api/portal/{token}` | 200 (no auth needed) | 200 |
| `POST /api/invites/3/negotiations` (Product Manufacturing, no price/etd) | 422 (validation) | 422 (validation) |

Price + ETD enforcement preserved for Product Manufacturing & Polythene Bags external quotes.

## UI Verification (Playwright)
- Vendor login (button-login-user-8) → VendorDashboard renders.
- Heading: "Vendor dashboard — your assigned RFQs" (data-testid `heading-vendor-dashboard`).
- Sub-header: "Acting as Vendor · Maria Jensen".
- Card count = 1 (`text-vendor-rfq-count` = "(1)").
- Card shows: package category, reference, project name, qty, target ETD, response due, current "Your response" (USD 12,500 · ETD Sep 01, 2026), status badge "Under negotiation", "Open response portal" button.
- Internal panels NOT in DOM (count=0): user-directory, quote-comparison, rfq-documents, award-recommendation, amendment-history, system-settings, audit-trail, account-switcher, sidebar-toggle.
- No vendor leak: page text excludes other vendor names ("Coastal", "OceanCoir").
- Mobile (375x812): no horizontal overflow, all content readable, sign-out button visible.

## Build / Tooling
- `npm run check` — clean (no TS errors)
- `npm run build` — clean (only chunk-size warnings, unrelated/pre-existing)
- Production server: `NODE_ENV=production node dist/index.cjs`, port 5000

## Demo Path
1. Open the deployed URL → click "Maria Jensen — Subcontractor (vendor dashboard + portal)".
2. Lands on Vendor Dashboard with the single assigned MFG-2026-0001 RFQ.
3. Click "Open response portal" → token-based external response page (existing behavior).
4. Sign out → can switch to any other persona.

## Assumptions
- Demo seed already links Maria Jensen (id=8, subcontractorId=1) — confirmed.
- Vendor shell intentionally omits AccountSwitcher (would 403 against /api/users) and sidebar; sign-out button suffices for demo persona switching.
- Did not redesign Home/commercial flows; only added a dedicated path for subcontractor_user.
