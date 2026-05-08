# RFQ spec & bulk send enhancements — implementation summary

Commit: `c291c1f` (on `master`, follows `8b0df8c`).

## What changed

### Schema (`shared/schema.ts`, `shared/roles.ts`)
- `polybagSpecsSchema` now requires `marketedSize {length,width,height}` + `actualSize {length,width,height}` + `gauge` + `etdRequired`. Legacy `bagSize` string preserved for back-compat reads.
- New `manufacturingSpecsSchema` ({ materialSpecification, productSize, ecLevel }) required on external manufacturing-subcontractor RFQs.
- `insertRfqSchema` no longer requires the client-supplied `reference` (server generates).
- Added `updateRfqSchema` (PATCH body), `bulkInviteSchema` (POST bulk body).
- New constant `RFQ_CODE_PREFIX` mapping each category to its prefix (MFG, PAL, POLY, CARD, PACK, LOG, OTH).
- `AUDIT_EVENT_TYPES` and `NOTIFICATION_TYPES` extended with `rfq_updated` and `invites_bulk_sent`.
- `RolePerms.canEditRfq` introduced — Senior Mgmt always; Commercial Manager always; Commercial Staff with the send-RFQs grant; Factory User (route narrows to wooden_pallets); Platform Admin denied.

### Server (`server/storage.ts`, `server/routes.ts`, `server/index.ts`)
- `createRfq` validates polybag (both sizes + gauge + ETD), validates external manufacturing specs, generates the next reference for the category as `<PREFIX>-YYYY-NNNN`, deduplicates against existing references.
- New `updateRfq` storage method:
  - Rejects edits on awarded/accepted/closed RFQs (409).
  - Locks `category`, `requestType`, `requestingCompanyId` once invites exist.
  - Recomputes workflow + price visibility when category/requestType changes pre-invite.
  - Merges polybag/manufacturing specs into `materialSpecs`.
  - Fans out `rfq_updated` notifications to admin/commercial + each existing invite (subcontractor portal, factory, intercompany), without leaking hidden prices or admin-only docs.
- New routes:
  - `PATCH /api/rfqs/:id` — role-gated edit, writes `rfq_updated` audit event.
  - `POST /api/rfqs/:id/invites/bulk` — accepts `subcontractorIds[] | factoryIds[] | companyIds[]` plus a country filter; iterates via existing `inviteRecipient` (so cluster, India, and category routing are still enforced). Returns `{ successes, failures }` and writes an `invites_bulk_sent` audit event in addition to per-invite `invite_sent` audit rows.
- Global error handler in `server/index.ts` now maps Zod validation errors to **422** with the first issue's path/message.

### Frontend (`client/src/pages/home.tsx`, `client/src/pages/portal.tsx`, `client/src/components/notification-center.tsx`)
- Removed the user-edited Reference field; the server generates the code and it is displayed in cards/details.
- New “Step 1 — Request type” radio-card picker with three highly visible options:
  - **External Vendor / Subcontractor RFQ**
  - **Internal Factory ETD Request**
  - **Intercompany Production Request**
- Polybag specs panel now collects Marketed L/W/H and Actual L/W/H plus gauge and ETD required.
- New “Manufacturing specs” panel (Material specification textarea, product size, EC level) shown only for external manufacturing RFQs.
- Detail card adds a banner per spec set (price-validity, polybag with both sizes, manufacturing).
- New “Edit RFQ” button on the detail card opens an inline `EditRfqPanel`. The panel mirrors the create flow (request-type radios, category select, all editable fields, polybag/manufacturing spec rows). When invites exist it disables request-type and section/category to enforce the server-side lock.
- Vendor send block replaced with a country filter + multi-select checkbox list:
  - Country dropdown (All countries / Sri Lanka / India / Indonesia).
  - Selected count, Select all, Clear, **Send RFQ to N selected** button (`button-bulk-send`).
  - Inline result banner showing successes/failures with the per-vendor reason.
  - India routing block applied at the row level.
- Portal page splits the polybag card into Marketed size and Actual bag size, plus a separate Manufacturing specs card for external manufacturing invites. Hidden-price internal flow still hides price.
- `notification-center.tsx` adds the `rfq_updated` icon meta (Pencil, violet) so the new notifications render correctly.

## Tests run

All against the running server:

| Test | Result |
|------|--------|
| Polybag create with full marketed + actual sizes | 200, returns `POLY-2026-0001` |
| Polybag missing actualSize | 422 `polybagSpecs.actualSize: Required` |
| External manufacturing create with full specs | 200, returns `MFG-2026-0001` |
| External manufacturing missing specs | 422 with the storage-level message |
| Bulk send (2 vendors, both valid) | 200, 2 successes / 0 failures |
| Bulk send mixing manufacturing vendor into a polybag RFQ | 200, includes per-vendor failure message |
| PATCH safe field edit on RFQ with invites | 200 |
| PATCH category change on RFQ with invites | 409 (locked) |
| `rfq_updated` notifications fanned to admin + each subcontractor invite | confirmed via `/api/notifications?rfqId=...` |
| `rfq_updated` audit event written | confirmed via `/api/audit-events?rfqId=...` |
| Platform Admin PATCH | 403 |
| `npm run check` (tsc) | clean |
| `npm run build` | clean |
| Playwright dashboard, polybag form, multi-select, edit panel, mobile | screenshots saved |

Screenshots: `qa-rfq-1-login.png` … `qa-rfq-7-mobile-form.png` in repo root.

## Deployment

Deployed via `deploy_website` to a private preview. Production server runs `node dist/index.cjs` on port 5000 inside the sandbox.

## Assumptions / open product decisions

- **Reference back-compat.** Previously seeded RFQs keep their `RFQ-2026-0xx` IDs; only new RFQs use the category prefix.
- **Manufacturing specs on internal flows.** Required only for `external_rfq` + `manufacturing_subcontractor`. Internal ETD / intercompany requests still create without specs (legacy data and the historical use case stay intact). Move to required for all manufacturing if operations want it.
- **Edit dialog placement.** Implemented as an inline panel under the detail header (not a modal) so it fits in the existing flow on mobile and desktop. Could be promoted to a `Dialog` later.
- **RFQ code dedup.** Sequence is computed by scanning existing references; the unique constraint on `rfqs.reference` is the safety net. A separate counter table would be more robust at higher write volumes.
- **Multi-recipient bulk endpoint** delegates to existing `inviteRecipient` per id, so all routing rules (cluster availability, India, vendor category) reuse the same code path. If a transactional all-or-nothing semantic is needed later, wrap in a SQLite transaction.
- **Factory User edits.** The route accepts factory edits only when category === wooden_pallets, matching the existing factory-managed flow. If the workflow expands, the factory check needs to widen.

## Files changed

- `shared/schema.ts`
- `shared/roles.ts`
- `server/index.ts`
- `server/routes.ts`
- `server/storage.ts`
- `client/src/pages/home.tsx`
- `client/src/pages/portal.tsx`
- `client/src/components/notification-center.tsx`
- New screenshots `qa-rfq-1-login.png` through `qa-rfq-7-mobile-form.png`
- This summary file `RFQ_EDIT_BULK_SUMMARY.md`
