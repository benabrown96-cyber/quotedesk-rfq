# Product-line Production Splits — Implementation Summary

## What changed
Production splits moved from the RFQ level into each product line. A single RFQ may now mix products with different splits (or none).

### Schema (`shared/schema.ts`)
- `productionSplits` is a new optional field on `productLineSchema` (nullable, min 2 rows when present).
- RFQ-level `productionSplits` remains accepted on both `insertRfqSchema` and `updateRfqSchema` for legacy compatibility only.
- `readProductLines` parses and validates per-line splits; legacy synthesised lines default to `productionSplits: null`.

### Server (`server/storage.ts`)
- `createRfq` and `updateRfq` clean each product line's `productionSplits`, enforcing at-least-2 rows and rejecting malformed rows with 422 (`Product line N: …`).
- Notifications: the multi-product summary now appends `— split across N locations: A (60%), B (40%)` per line that carries one. Legacy RFQ-level split notice is suppressed when any line has its own.
- `rfq_updated` audit + notification flow unchanged — editing per-line splits flips `materialSpecs` and triggers the existing fan-out to invited recipients and admins.

### Create form (`client/src/pages/home.tsx`)
- `SplitsField` removed. Schema, default values, the manufacturing-only reset effect, and the payload mapping no longer reference `splitEnabled` / `productionSplits` at the RFQ level.
- The category-aware reset effect was removed; splits are no longer a create-time concept.

### Edit RFQ panel (`client/src/pages/home.tsx`)
- New `ProductLineSplitsEditor` component renders inside each product card.
- Toggle "Split this product across locations?" seeds two empty rows; turning it off clears the splits.
- Save sends `productLine.productionSplits` per line; rows below 2 are rejected client-side and server-side.
- Legacy RFQ-level splits are migrated to product 1 on open; saving from this panel always nulls the RFQ-level splits, so the system converges to per-line splits over time. A small inline note explains the migration.
- Awarded/closed RFQs and Platform Admin users keep the existing edit gate — no permission changes.

### Detail view (`client/src/pages/home.tsx`)
- Each product card shows its split inline as `Split across N locations: …` directly under the product. No banner is shown for products without a split.
- The standalone RFQ-level split banner now reads "Legacy RFQ-level production split…" and only renders when no line carries its own split.

### Portal (`client/src/pages/portal.tsx`)
- Each product card includes its own split sub-card (location + allocation + optional note + the "Quote for the share you are asked to commit to." hint).
- Legacy RFQ-level split notice is suppressed when any product line has its own; otherwise it renders as "Legacy RFQ-level production split…".
- Portal still has zero internal edit controls (no toggle / save buttons leak to vendors).

## Tests run
- `npm run check` — clean (TypeScript).
- `npm run build` — clean (Vite client + esbuild server bundle).
- API smoke (curl):
  - Create with two product lines, splits on line 1 → saved correctly.
  - Single-row split → rejected `productLines.0.productionSplits: too_small`.
  - Empty `locationName` → rejected with field path.
  - PATCH /api/rfqs/:id moving split from line 1 to line 2 → saved correctly; line 1 splits cleared.
  - `rfq_updated` notification fired for senior management.
- Playwright (1280×900 desktop + 375 mobile):
  - Create form: no `panel-production-splits` / `switch-split-enabled` present.
  - Detail (RFQ 18): two product cards, line 2 shows nested split, no legacy banner.
  - Detail (legacy RFQ MFG-2026-0004): "Legacy RFQ-level production split" banner with migration hint.
  - Edit panel: two `panel-edit-product-line-splits-*`, no RFQ-level split panel.
  - Portal: per-line split inline; no internal edit controls; mobile no overflow.

## Deployment
- Preview deployed via `deploy_website` (asset id `a6f68786-37b1-4f7c-bea9-009f9f5762c6`).

## Commit
- `fa2a669` `feat: per-product-line production splits`

## Changed files
- `shared/schema.ts`
- `server/storage.ts`
- `client/src/pages/home.tsx`
- `client/src/pages/portal.tsx`
- (plus QA screenshots prefixed `qa-pls-…`)

## Assumptions
- Legacy RFQ-level splits are auto-attached to product line 1 when the user opens Edit RFQ. On save the RFQ-level split field is cleared so each RFQ converges to per-line splits. We surface a migration hint in both detail and edit views.
- The intercompany / internal-factory portals reuse the same `portal.tsx` layout, so splits render identically across all manufacturing recipient types.
- Polybag and cardboard categories are unaffected — splits are still gated by `manufacturing_subcontractor` only.
- Notification line summaries truncate per-line splits inside the existing 6-line products cap; we did not add a separate truncation rule.

## Remaining product decisions
- Whether to ever auto-migrate legacy RFQ-level splits server-side without an editor visit. Currently migration is opportunistic (only when a user opens Edit). A backfill script could be added if desired.
- Whether to allow splits with a single row (e.g., "100% at one site") as an audit-trail artefact. Current rule still enforces min 2 — matches the prior behavior.
- Whether allocations should be validated to sum to 100% when expressed as percentages. We deliberately keep allocations free-form (mix of "%", "units", etc.).
