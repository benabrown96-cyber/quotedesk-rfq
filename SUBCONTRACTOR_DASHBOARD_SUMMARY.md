# Subcontractor Restricted Dashboard — Implementation Summary

## Outcome
Authenticated `subcontractor_user` accounts can now sign in and reach a dedicated, scoped vendor dashboard. They are no longer shown the "blocked" page. They see only their own RFQ invites with portal-safe data; everything internal (users, settings, comparisons, recommendations, documents, other vendors' quotes, PO context) remains 403 at the API and absent from the UI.

## Commit
- Hash: **e103d74**
- Branch: main
- Message: "feat: restricted authenticated vendor dashboard for subcontractor users"

## Deployment
- Site: **QuoteDesk RFQ**
- Deployed via `deploy_website` from `/home/user/workspace/rfq-system/dist/public`
- Production server (`NODE_ENV=production node dist/index.cjs`) running on port 5000 to serve the API proxy.

## Changed Files
| File | Change |
|---|---|
| `server/routes.ts` | Subcontractor allow-list middleware moved to immediately after `attachRole` so it gates ALL `/api/*` routes (including users/settings). Allow-list = `/portal/*`, `/me`, `GET /rfqs`, `GET /rfqs/:id` (numeric only). `GET /api/rfqs` filters by `user.subcontractorId` via new `storage.rfqIdsForSubcontractor`. `GET /api/rfqs/:id` strips `partnerClient`, `poCountry`, `poCustomerName`, `escalationReason`, omits `producingCompany` / `producingFactory`, and filters invites to only the vendor's own `external_subcontractor` invite(s). Removed prior blanket-block placement. |
| `server/storage.ts` | Added `rfqIdsForSubcontractor(subcontractorId)` to `IStorage` and `DrizzleStorage` — filters `rfq_invites` by `subcontractorId` and `recipientType='external_subcontractor'`. |
| `shared/roles.ts` | `RolePerms.canViewDashboard` now `true` for all roles. `subcontractor_user` persona label/description updated to "Subcontractor (vendor dashboard + portal)" / "Vendor". |
| `client/src/pages/vendor-dashboard.tsx` (new, 319 lines) | `VendorDashboard` React page. Uses TanStack Query against `/api/rfqs` and per-card `/api/rfqs/:id`. Cards show reference, project, package, qty/unit, target ETD, response due, current submitted price/ETD ("USD X · ETD Y" or "Not yet submitted"), status badge, and external portal launch (`#/portal/{token}`). Loading skeletons, empty state, error state. Helper card explaining scope. Dense `data-testid` coverage. |
| `client/src/App.tsx` | Replaced `SubcontractorBlocked` with `VendorShell` — slim header (logo, "Acting as Vendor · {name}", theme toggle, sign-out). No sidebar. No `AccountSwitcher` (would 403 against `/api/users`). `InternalShell` short-circuits to `VendorShell` when `role === 'subcontractor_user'`. |

## Tests Run

### Build
- `npm run check` — TypeScript clean, no errors.
- `npm run build` — Vite + esbuild succeeded.

### API matrix (curl, vendor user id=8 / Maria Jensen, subcontractorId=1)
Allowed:
- `GET /api/me` → 200 (returns Maria's record)
- `GET /api/rfqs` → 200, count=1 (only RFQ id=2)
- `GET /api/rfqs/2` → 200, exactly 1 invite, `partnerClient`/`escalationReason`/`poCustomerName` all null, no `producingCompany`/`producingFactory` keys.
- `GET /api/portal/{token}` → 200 (token-portal flow unchanged for both authenticated and anonymous callers).

Blocked (403):
- `/api/users`, `/api/settings`, `/api/subcontractors`, `/api/audit-events`, `/api/notifications`, `/api/companies`, `/api/factories`, `/api/rfqs/2/documents`, `/api/rfqs/2/recommendations`, `/api/rfqs/2/amendments`, `POST /api/rfqs`, `POST /api/invites/1/negotiations`.

### Internal roles preserved
- `senior_management` (Priya, id=1): `/api/users` 200; `/api/rfqs` returns 3 RFQs; RFQ 2 shows both invites.
- Browser nav for senior_management still shows sidebar + RFQ workspace + subcontractors links unchanged.

### Validation preserved
- `POST /api/portal/{token}/quotes` for a Product Manufacturing RFQ without price+ETD → still **422** with: "External vendor responses for Product Manufacturing must include both price and ETD."

### Playwright browser QA
- Desktop 1280×800: vendor login → dashboard renders; heading "Vendor dashboard — your assigned RFQs"; helper text confirming restrictions; count "(1)"; card with project, package, qty/unit, my response "USD 12,500 · ETD Sep 01, 2026"; sign-out button; no leak of other vendor names ("Coastal", "OceanCoir") in DOM.
- Forbidden testids absent from DOM: `user-directory`, `quote-comparison`, `rfq-documents`, `award-recommendation`, `amendment-history`, `system-settings`, `audit-trail`, `account-switcher`, `link-rfq-workspace`, `link-subcontractors`, `sidebar-toggle`.
- Mobile 375×812: zero overflow (`document.scrollWidth === window.innerWidth`).
- Senior_management browser session: sidebar + `link-rfq-workspace` + `link-subcontractors` all present, vendor heading absent.

### QA artifacts (in `rfq-system/`)
- `qa-vendor-1-login.png` — login page
- `qa-vendor-2-dashboard.png` — vendor dashboard desktop
- `qa-vendor-3-mobile.png` — vendor dashboard mobile (375×812)
- `qa-internal-1-senior.png` — senior_management view, regression check

## Assumptions
1. "Vendor" terminology preferred over "Subcontractor" in UI surfaces (matches the user's broader "subcontractor/vendor" framing).
2. `AccountSwitcher` removed for vendors — it queries `/api/users` which is now correctly 403. Replaced with a simple Sign-out button (`button-vendor-sign-out`).
3. Portal launch uses the existing per-invite token via the SPA hash route (`#/portal/{token}`); revoked tokens render "Portal link revoked — contact TEG."
4. The middleware allow-list keys off `req.path` as it appears inside `app.use("/api", ...)` — i.e. relative paths (`/me`, `/rfqs`, `/rfqs/:id`, `/portal/...`) — and order-of-registration matters; the middleware MUST run before any handler that registers a forbidden route.
5. Vendor `RfqDetail` response shape intentionally drops `producingCompany`/`producingFactory` to avoid revealing TEG's internal cluster structure.
