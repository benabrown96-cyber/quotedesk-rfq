# RFQ Category / Sections — Implementation Summary

## Commit
`ce44eb3` — feat: RFQ category sections — split manufacturing subcontractors from material/service suppliers

## Overview
The RFQ system now supports **seven sections** so different inquiry types live side-by-side without polluting the manufacturing-subcontractor flow. Existing manufacturing subcontractor flows are unchanged; suppliers (pallets, polythene bags, cardboard, packaging, logistics, etc.) now have a first-class home with the same negotiation, award, notification, audit, expiry, and portal-token machinery.

## Categories
| Key | Label | Vendor noun |
| --- | ----- | ----------- |
| `manufacturing_subcontractor` | Manufacturing Subcontractor | manufacturing subcontractor |
| `wooden_pallets` | Wooden Pallets | pallet supplier |
| `polythene_bags` | Polythene Bags | poly bag supplier |
| `cardboard` | Cardboard / Cartons | cardboard supplier |
| `packaging_materials` | Packaging Materials | packaging supplier |
| `logistics_shipping` | Logistics / Shipping | logistics provider |
| `other_supplies` | Other Suppliers | supplier |

## Schema changes (safe additive migrations)
- `rfqs.category TEXT NOT NULL DEFAULT 'manufacturing_subcontractor'`
- `subcontractors.vendor_type TEXT NOT NULL DEFAULT 'manufacturing_subcontractor'` (`manufacturing_subcontractor` | `supplier`)
- `subcontractors.supported_categories TEXT NOT NULL DEFAULT '[]'` (JSON array of categories)
- `subcontractors.materials_supplied TEXT` (free-form description)

Backfill at boot:
- Existing RFQs ⇒ `manufacturing_subcontractor`
- Existing subcontractors ⇒ `vendor_type='manufacturing_subcontractor'`, empty supported list (treated as manufacturing-only)
- Idempotent supplier seeding reclassifies the previously-seeded `Lanka Pallet Works` as a supplier and adds `PolyPack Sri Lanka`, `CartonPro Lanka`, `OceanBridge Logistics`.

## Server enforcement
- `inviteRecipient` blocks invites where the vendor's effective categories don't match the RFQ's section (HTTP 422 `VENDOR_CATEGORY_BLOCKED_MESSAGE`).
- `createRfq` forces `category='manufacturing_subcontractor'` (and `priceVisibility='hidden' / negotiationScope='etd_only'`) for internal ETD / intercompany requests, even if the client tries to override.
- External supplier RFQs (`requestType='external_rfq' && category!=='manufacturing_subcontractor'`) get visible price + `price_etd` negotiation scope automatically.
- `GET /api/subcontractors?category=<cat>` returns only vendors that pass the compatibility check (cluster + India rules also still applied).
- India routing, cluster availability, token security, expiry, awards, and audit/notification fan-out are unchanged.
- Audit summaries on `rfq_created` and `invite_sent` now include the RFQ category. Notification subjects/bodies for supplier RFQs say "supplier RFQ" with a "Section: ..." line and the supplier-specific portal copy.

## UI
- **Dashboard register** has section tabs (`All sections` + 7 categories) with live counts. Selecting a tab filters the RFQ list and shows the section's helper copy. Each RFQ card now displays a section badge.
- **Create RFQ form** has a new `RFQ section` Select. It is locked to "Manufacturing Subcontractor" when `requestType` is internal ETD or intercompany; otherwise the user picks the section, with helper text that explains what the section covers.
- **Vendor picker** (`Send outside…` and the escalation picker) shows only vendors whose `vendor_type` / `supportedCategories` match the selected RFQ's category. The internal-factory ETD picker is hidden for non-manufacturing supplier RFQs since factory ETD-only flow doesn't apply. Helper copy explains the filter.
- **Vendor management form (`Add vendor`)** now has Vendor type, Supported categories (multi-checkbox, only for supplier vendors), and Materials supplied. Manufacturing vendors are always treated as manufacturing-only; supplier vendors with no list default to "Other Suppliers".
- **Vendor availability panel** (cluster admin) gains a Type / categories column with badges.
- **Supplier portal** renders category-aware copy: banner says `SUPPLIER RFQ SESSION — UNIT PRICE (USD) + DELIVERY DATE FOR <CATEGORY>`, header reads `<Category> supplier portal`, notification body references the section. Manufacturing portal and internal factory portal copy are unchanged.

## Permissions (unchanged from prior commit, reapplied to vendors)
- Senior Management: full visibility, awards, vendor management, cluster access edits.
- Platform Admin: vendor master-data manageable (since they could already manage subcontractors); still cannot award or open commercial reference docs.
- Commercial Manager: cluster-scoped vendor management + send/negotiate within cluster.
- Commercial Staff: create RFQs by default; need `Send RFQs` / `Negotiate` / `Recommend awards` grants for those actions; never finalises an award.
- Factory User: unaffected — only sees internal ETD-only invites for their factory; supplier RFQs are not surfaced.
- Subcontractor / supplier portal user: tokenised invite only, no dashboard.

## Tests run
- `npx tsc --noEmit` — clean
- `npm run build` — clean (Vite + tsx server bundle)
- API smoke tests via curl confirmed:
  - GET subcontractors lists 7 vendors with new fields
  - `?category=wooden_pallets` returns only Lanka Pallet Works
  - `?category=manufacturing_subcontractor` returns the 3 manufacturing subs
  - Cross-category invites blocked with 422 (manufacturing vendor → pallet RFQ; pallet supplier → manufacturing RFQ; PolyPack → pallet RFQ)
  - In-category invites succeed (Lanka Pallet → pallet RFQ → priceVisibility=visible, status=sent)
  - India routing still blocks Indian subs under Growrite
  - Internal ETD requests forced to `manufacturing_subcontractor` even when client sends a different category
  - Senior Management awards a supplier RFQ successfully
  - Platform Admin receives 403 on `/api/rfqs/.../award`
- Browser QA via Playwright at desktop and mobile (390×800):
  - Section tabs render and filter correctly across Senior Mgmt and Platform Admin
  - Vendor picker only shows the matching supplier on a Pallet RFQ
  - Section badges visible on cards
  - Supplier portal banner / portal kind / notification body all category-aware
  - Mobile layout has no overflow; tabs wrap

QA screenshots saved as `qa-cat-1-login.png` … `qa-cat-9-mobile-tabs.png`.

## Operational guidance — how to use the new sections

- **Create a Manufacturing RFQ (factory work, subcontractor processing).** Use Request type = External RFQ + Section = Manufacturing Subcontractor (or any internal ETD / intercompany request — those auto-tag manufacturing). The vendor picker shows manufacturing subcontractors only. Indian-routing rules remain in force.
- **Create a Supplier RFQ (pallets, polythene, cardboard, packaging, logistics, other).** Use Request type = External RFQ + Section = the relevant supplier section. Price visibility is automatically visible; negotiation scope is price + delivery date. The vendor picker shows only suppliers whose supported categories include that section.
- **Adding new vendors.** From the vendor card, choose Vendor type:
  - "Manufacturing Subcontractor" for factory-style processors.
  - "Supplier (materials / services)" for pallet/poly/carton/logistics/etc. vendors. Tick every section the supplier can quote for. Leave the materials/services field free-form.
- **Filtering / overview.** The dashboard tabs above the register let any internal user jump between sections to see only the RFQs in that flow with live counts.
- **Award + notifications.** Identical to before — Senior Management approves recommendations and finalises awards. Notifications and audit lines now carry the RFQ section so audit reviewers can see at a glance whether the change relates to a manufacturing or supplier flow.

## Assumptions / decisions
- Internal ETD-only and intercompany requests are *always* manufacturing because TEG's internal factories produce product, not pallets/cartons. Server enforces this even if the client sends a different category.
- Supplier RFQs always have visible price + price_etd negotiation. ETD-only price-hidden flow stays reserved for the manufacturing factory thread.
- We extended the `subcontractors` table rather than renaming to `vendors` to keep the migration small and back-compat with all existing rows, audit events, notifications, and tokens. Routes and dashboard copy say "vendor" where the broader concept applies; "manufacturing subcontractor" stays where the term is meaningful.
- "Other Suppliers" is the default for supplier vendors without an explicit category list, so the system stays usable if someone adds a vendor without filling the checklist.
- `qa-cat-*.png` screenshots are saved at the repo root for review.
