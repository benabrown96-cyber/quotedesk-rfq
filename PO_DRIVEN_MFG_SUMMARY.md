# Product Manufacturing PO-driven submission

## Summary

Product Manufacturing RFQs are sent only after a price quotation is produced and a
purchase order is received from a partner / client. The create-RFQ flow now matches
that reality:

- Project / Order / Scope description fields are removed from the create form for
  Product Manufacturing RFQs (and for the Edit RFQ panel when the category is
  manufacturing). They remain in place for non-manufacturing categories (polybags,
  cardboard, packaging, logistics, other).
- The form now collects three new commercial-context fields:
  - **Partner / Client** \u2014 the partner that issued the PO. Picker is filtered by
    the cluster of the selected requesting company; users can also type a partner
    that is not in the master list.
  - **Country** \u2014 partner's country (auto-filled when picking from the master
    list, free-text otherwise).
  - **Customer name (as stated on PO)** \u2014 the end-customer named on the PO. May
    differ from the partner.
- A **PO upload** sits at the top of the manufacturing block. The selected file is
  sent to a new server endpoint that runs heuristic text extraction and returns
  partner / country / customer suggestions plus a confidence score and notes. The
  form pre-fills any field the user has not already typed in. Manual review and
  edit are always allowed before creating the RFQ.

The uploaded PO is **not persisted** and is **not shared** with factories or
vendors. It is used only for extraction. Formal PO upload remains the existing
admin-only `Admin reference documents` panel that is visible to Senior Management
only and never appears in portals.

## Server changes

- `shared/schema.ts`
  - New `partnerClient`, `poCountry`, `poCustomerName` columns on `rfqs`.
  - New `partnerClients` master table (id, name, country, clusterName, active,
    createdAt).
  - `insertRfqSchema` accepts the three new fields. `projectName` /
    `packageName` / `description` / `quantity` / `unit` are optional now and are
    server-derived for manufacturing RFQs (so existing notNull DB columns stay
    populated). Non-manufacturing creates still require them.
  - `updateRfqSchema` accepts the three new fields so Edit RFQ flows can change
    them. Edits flow even when invites already exist (it is commercial context,
    not routing) so recipients receive an `rfq_updated` notification.
  - New `poExtractRequestSchema` + `PoExtractResult` type for the extraction
    endpoint.
- `server/storage.ts`
  - Schema migration adds the three RFQ columns and creates `partner_clients`.
  - Seeds 8 sample partners across both clusters so the picker is never empty.
  - `createRfq` validates partner / country / customer for manufacturing RFQs,
    derives readable `projectName` / `packageName` / `description` defaults, and
    persists the new columns.
  - `updateRfq` propagates the three fields through `setIf`, including them in
    the changed-fields list and the `rfq_updated` notification body (now adds a
    `Partner / Client: ...` and `Customer stated on PO: ...` line for
    manufacturing RFQs).
  - New `listPartnerClients({ clusterName? })` reads master data filtered by
    cluster.
- `server/po-extract.ts`
  - Heuristic text extractor.
  - Text / CSV / JSON: decoded directly.
  - PDF: best-effort scan of parenthesised strings inside the binary stream
    (covers most modern text-bearing PDFs without bringing in `pdf-parse` or
    other native deps).
  - Image-only / scanned PDFs return `textExtractionFailed=true` with a clear
    note that OCR integration is required later. Avoids any paid API.
  - Looks for labels: `Partner`, `Client`, `Buyer`, `Bill from`, `Issued by`,
    `From`, `PO Issuer`, plus customer-side `Customer`, `Ship to`, `Deliver to`,
    `Consignee`, `Sold to`, `End Customer`, `PO Customer`. Country is detected
    from a `Country:` label or a known-country keyword scan.
  - Returns `confidence` (high/medium/low/none), `matchedLabels[]`, `notes[]`.
- `server/routes.ts`
  - New `GET /api/partner-clients?cluster=...` returns the master list, optionally
    filtered by cluster.
  - New `POST /api/po-extract` accepts a base64 file + mime + filename + cluster
    hint, runs `extractPoFields`, returns suggestions. Permission gated to roles
    that can create RFQs.

## Client changes

- `client/src/pages/home.tsx`
  - New `ProductManufacturingPoFields` block replaces Project / Order / Scope
    when the category is `manufacturing_subcontractor`. Includes the partner
    picker (filtered by cluster), Country, Customer name, and the PO upload
    button with extraction-result panel + notes.
  - `EditRfqPanel` shows Partner / Client, Country, and Customer name inputs
    when the RFQ is manufacturing; legacy Project / Order / Scope inputs only
    appear for non-manufacturing categories.
  - RFQ detail panel: replaces the legacy Scope field with the three PO fields
    on manufacturing RFQs.
  - Card title and side-list summary use the partner name (and the PO customer
    when available) for manufacturing rows.
  - Form schema: superRefine now requires `partnerClient` / `poCountry` /
    `poCustomerName` for manufacturing and keeps the legacy Project / Order /
    Scope rules for everything else.
  - Mutation payload: manufacturing creates send only the three new fields,
    derived quantities, and product lines; non-manufacturing still sends the
    legacy fields.
- `client/src/pages/portal.tsx`
  - `PortalDetail.rfq` typed with the three new fields.
  - Card title shows the partner / customer name on manufacturing RFQs.
  - The scope block is replaced with Partner / Country / Customer stated on PO
    cards. A note states the PO document itself is not shared.

## Data model compatibility

The existing notNull `projectName` / `packageName` / `description` /
`quantity` / `unit` columns on `rfqs` are preserved. For manufacturing creates
that omit them, `createRfq` synthesises readable defaults from the partner,
customer, and the first product line so summary screens, audit logs, and
notifications never see empty strings. Non-manufacturing creates still require
them.

## PO extraction \u2014 capabilities and limitations

| Format            | Status                                                |
| ----------------- | ----------------------------------------------------- |
| `.txt`, `.csv`, `.md`, `.json` | Full label-based extraction.            |
| Text-bearing PDFs | Best-effort \u2014 reads parenthesised text fragments inside content streams. Works on most exported PDFs. |
| Scanned PDFs / image PDFs / `.png` / `.jpg` | Not supported. Returns `textExtractionFailed=true`, surfaces an OCR-required note in the UI; user fills the fields manually. |

Confidence is `high` when all three fields were detected, `medium` when two, and
`low` when one. The user is always allowed to edit the values before creating
the RFQ.

No external paid APIs / secrets were introduced.

## Validation matrix

| Category                       | Required fields on create                                        |
| ------------------------------ | ---------------------------------------------------------------- |
| `manufacturing_subcontractor`  | `partnerClient`, `poCountry`, `poCustomerName`, `productLines`   |
| `wooden_pallets` / `cardboard` | Project, Order, Scope, Quantity, Unit, target ETD (existing rules unchanged) |
| `polythene_bags`               | Project / Order / Scope, Quantity, Unit, polybag specs (existing rules unchanged) |
| `packaging_materials` / `logistics_shipping` / `other_supplies` | Project / Order / Scope, Quantity, Unit (existing rules unchanged) |

## Tests / QA performed

- `npm run check` \u2014 clean
- `npm run build` \u2014 clean
- API smoke:
  - `GET /api/partner-clients` returns 8 seeded partners; `?cluster=...` filters
    by cluster.
  - `POST /api/po-extract` with text PO returns high-confidence Partner +
    Country + Customer.
  - `POST /api/po-extract` with image PNG returns `textExtractionFailed=true`
    and a helpful note.
  - `POST /api/rfqs` with manufacturing category and missing partner -> 422
    with explicit error.
  - `POST /api/rfqs` with manufacturing category + new fields -> 201 with
    server-derived projectName / packageName / description.
  - `POST /api/rfqs` for `polythene_bags` with the legacy fields -> still works.
  - `PATCH /api/rfqs/:id` editing partner / country / customer -> 200 and
    `rfq_updated` notification body now lists `Partner / Client` and
    `Customer stated on PO`.
- Browser QA (Playwright):
  - Create form on Senior Management view shows the new PO context block, hides
    legacy Project / Order / Scope.
  - Uploading a sample PO populates the three fields and shows the confidence
    panel with matched labels.
  - RFQ detail panel shows Partner / Country / Customer rows and the card title
    shows the partner.
  - Portal page (token route) shows the partner as the title and the three PO
    fields, no PO document.
  - Mobile (375px) layout: PO context panel and portal both render without
    overflow.
