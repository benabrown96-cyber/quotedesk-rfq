# Material Workflow Changes — Implementation Summary

**Commit:** `8b0df8c` (parent: `ce44eb3`)
**Deploy preview:** uploaded successfully via `deploy_website` (rfq-system/dist/public)

## What changed

### 1. Wooden pallets — factory-managed, hidden from commercial flow
- `wooden_pallets` removed from the create-RFQ category dropdown for `commercial_staff` and `commercial_manager`.
- Removed from the section-tabs and the RFQ register list for those roles. Sections counts also exclude pallet rows.
- Server endpoint `POST /api/rfqs` rejects `category=wooden_pallets` from commercial users (403 with clear copy referring them to the factory team).
- `factory_user`, `senior_management` (`group_admin` legacy alias), and `platform_admin` retain access. The category label was changed to `"Wooden Pallets (Factory-managed)"` so it is unambiguous in dropdowns / tabs.
- `factory_user` is now allowed to create RFQs — but only when category is `wooden_pallets`.

### 2. Wooden pallets + cardboard — 6-month price-validity inquiry workflow
- New `workflowType` enum: `standard_rfq | price_validity_inquiry | polybag_rfq`.
- `workflowForCategory(category)` maps `wooden_pallets` and `cardboard` → `price_validity_inquiry`. `polythene_bags` → `polybag_rfq`. Everything else → `standard_rfq`.
- New `priceValidityMonths` column (nullable). Defaults to 6 for price-validity workflow.
- Create form shows an inline panel: *"6-month price-validity inquiry — not a single-order RFQ"* with editable validity-months override.
- RFQ detail card shows a banner: *"Suppliers submit a unit price valid for N months. Acceptance records the price validity — a purchase order is issued later when stock is required."*
- Award button copy switches to **"Accept N-month price validity"** for these RFQs and closure copy makes clear it is *not* a single-order award.
- Supplier portal:
  - Header sub-label: `<Category> · 6-month price-validity inquiry`
  - Session banner: *"Price-validity inquiry — your unit price (USD) will remain valid for N months; PO issued later when required"*
  - Notice card explains the PO-later semantics.
  - Submit button: **"Submit 6-month price"**.
  - Acceptance footnote: *"Acceptance records your N-month unit-price validity — not a single order. TEG will raise purchase orders later as required."*
- Notification email body (`rfq_sent` to subcontractor) explicitly tells them the price will be valid for N months and that they are *not* being asked to ship a single order yet.

### 3. Polythene bags — specs-driven inquiry
- New required fields collected at create time: **bag size**, **gauge**, **ETD required**. Quantity / unit are still taken from the standard quantity-fields.
- Stored as JSON in a new `materialSpecs` column on `rfqs`.
- Server-side validation rejects polybag RFQ creation without all three specs (422).
- RFQ detail and supplier portal both show a polybag specs banner with bag size / gauge / ETD required.
- Notification email body includes the specs in the supplier copy.
- Suppliers respond with price (USD) + ETD as in a standard RFQ, so the existing lowest-price comparison and renegotiation flow works unchanged.

## Schema migration safety

All three new columns are added via `addColumn` (idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS`-style helper) plus an idempotent backfill that retroactively assigns workflow types / 6-month validity to existing pallet / cardboard / polybag rows. No table drops, no destructive rewrites.

## Roles & permissions matrix (after this change)

| Role | Create wooden_pallets | Create cardboard | Create polythene_bags | See pallet section |
|---|---|---|---|---|
| `senior_management` / `group_admin` | ✅ | ✅ | ✅ | ✅ |
| `platform_admin` | ✅ | ✅ | ✅ | ✅ |
| `commercial_manager` | ❌ (factory-managed) | ✅ | ✅ | ❌ |
| `commercial_staff` | ❌ (factory-managed) | ✅ | ✅ | ❌ |
| `factory_user` | ✅ (only category they can create) | ❌ | ❌ | ✅ |
| `subcontractor_user` | n/a | n/a | n/a | n/a (portal-only) |

## Tests run

- `npm run check` (`tsc`) — passes.
- `npm run build` (Vite + esbuild) — passes.
- API smoke tests via curl:
  - Polybag RFQ created with specs → returns `workflowType:"polybag_rfq"` + `materialSpecs` JSON.
  - Polybag RFQ without specs → `422 — "Polythene bag inquiries require bag size, gauge, and ETD required."`
  - Cardboard RFQ → `workflowType:"price_validity_inquiry"`, `priceValidityMonths:6`.
  - Pallet RFQ as `commercial_staff` → `403 — Wooden pallets are factory-managed …`.
  - Pallet RFQ as `factory_user` → 201 with workflow + 6-month validity.
  - Wrong-category vendor invite (manufacturing subcontractor on polybag RFQ) → still blocked with the existing `VENDOR_CATEGORY_BLOCKED_MESSAGE`.
- Playwright QA (screenshots saved in repo root):
  - `qa-mat-1-polybag-form.png` — create form with required polybag specs panel.
  - `qa-mat-2-cardboard-form.png` — create form with 6-month price-validity panel.
  - `qa-mat-3-commercial-tabs.png` — commercial_staff sees no pallet tab + no pallet RFQs in register.
  - `qa-mat-4-portal-polybag.png` — supplier portal with polybag specs + "Polybag inquiry" banner.
  - `qa-mat-5-portal-cardboard.png` — supplier portal with price-validity banner + "Submit 6-month price" button.
  - `qa-mat-6-senior-pallet-detail.png` — senior management can open pallet RFQ detail with workflow banner.
  - `qa-mat-7-mobile-polybag.png` — mobile (375 px) polybag form, no horizontal overflow.

## Assumptions made

- **Cardboard ownership:** the user said *"For Wooden Pallets and Cardboard, the process is not a normal repeated RFQ. They send an inquiry for price"* — so cardboard is treated as a price-validity inquiry but **kept on the commercial side** because the commercial team is the one *sending* the inquiry. Only wooden pallets are pulled fully into the factory-managed bucket.
- **Default validity:** 6 months when omitted, overridable in the form (1–60 months).
- **Acceptance semantics on price-validity inquiries:** acceptance records the chosen supplier's price validity and closes other invites with the existing closure mechanism. We did not introduce a separate "multi-supplier price book" — the underlying engine remains a single-winner pattern. POs are external to this system.
- **Polybag quantity / unit:** continue to use the existing `quantity` + `unit` fields rather than duplicating quantity inside `materialSpecs`.

## Remaining product question

> **Should cardboard price-validity be managed by Commercial or by Factories?**
>
> Current behaviour: Commercial users (manager + staff) can still create cardboard price-validity inquiries; only **wooden pallets** are restricted to factory_user / senior_management / platform_admin. If operations confirm that cardboard should also be factory-led, flipping `ownerTeamForCategory("cardboard")` to `"factory"` and adding `cardboard` to the role check that currently guards `wooden_pallets` is a one-line change. Left as-is until confirmed because the user's wording attributed the cardboard inquiry to the commercial team.

## Files changed

- `shared/schema.ts` — workflow types, helpers, polybag schema, new columns.
- `server/storage.ts` — migrations, `createRfq` workflow derivation + spec persistence, notification copy.
- `server/routes.ts` — pallet permission check, factory_user category restriction, audit summary.
- `client/src/pages/home.tsx` — category dropdown filter, section-tab filter, RFQ register filter, polybag/price-validity create panels, detail-card workflow banners, BuyerControls CTA copy.
- `client/src/pages/portal.tsx` — workflow detection, notice cards, polybag specs display, submit / acceptance copy.
