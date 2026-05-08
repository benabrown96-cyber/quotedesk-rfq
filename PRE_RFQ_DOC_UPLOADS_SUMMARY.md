# Pre-RFQ Document Uploads — Implementation Summary

## What changed

In the **Product Manufacturing → Create request** flow, the PO context panel now
contains **two upload boxes** rendered in this order:

1. **Pricing Quotation** — click-to-upload + drag-and-drop, no extraction.
   Held client-side until the RFQ is created, then attached as a
   `pricing_quotation` reference document.
2. **Purchase Order** — click-to-upload + drag-and-drop, runs heuristic
   extraction server-side. Surfaces the detected Partner / Country / Customer
   as a suggestion card with **per-field Apply** buttons + an **Apply all
   extracted values** button (no silent overwrites). Held client-side until
   the RFQ is created, then attached as a `purchase_order` reference
   document.

Both boxes:

- Show 15 MB max-size helper copy.
- Toggle a `data-dragging="true"` data attribute when a file is being
  dragged over (visual ring + bg color).
- Toggle a `data-has-file="true"` data attribute and a green ring once a
  file has been picked, with a Remove button to undo.
- Have stable `data-testid` attributes for every state (dropzone, dragging,
  has-file, busy/extracting, filename, size error, suggestion rows, apply
  buttons).

After `/api/rfqs` succeeds, the captured files are attached via
`POST /api/rfqs/:id/documents` in parallel. A success or warning toast is
shown plus an in-form **attachment status banner** (`panel-pre-rfq-attach-status`)
that lists per-document outcome. A failure on attach **never loses the
created RFQ** — the user can re-upload from the Senior Management docs panel.

## Bug fix — extracted values not populating fields

The previous implementation set values via `form.setValue("partnerClient", …)`
only when the field was blank. The user reported the PO Partner / Client
field wasn't getting filled. Two issues were addressed:

1. **The Partner / Client `<Select>` was wiping the bound RHF field.** A
   synthetic `__custom__` sentinel value was rendered when the typed/extracted
   name didn't match a seeded partner. Radix Select then fired
   `onValueChange("")` for the unresolved value, calling `pickPartner("")`
   which cleared `partnerClient`. The fix: leave the Select uncontrolled
   when the value isn't in the SelectItem list (just show the placeholder),
   and route Apply to RHF directly. Now typing _or_ Apply both stick.
2. **The "silent prefill only when blank" UX has been replaced** with a
   visible suggestion card. The user explicitly applies values per field
   or in bulk via "Apply all extracted values". Each row shows
   "APPLIED" once the form value matches the suggestion.

## Permissions / confidentiality

Reference document access used to be a single Senior-Management-only gate.
That gate has been split:

| Action          | Who                                                          |
| --------------- | ------------------------------------------------------------ |
| GET (list)      | Senior Management only                                       |
| GET (download)  | Senior Management only                                       |
| DELETE          | Senior Management only                                       |
| POST (attach)   | Senior Management, Commercial Manager, Commercial Staff      |

- `RolePerms.canUploadReferenceDocuments(role, ctx)` is the new permission.
- The route handler `requireReferenceDocUploadAccess` is used for POST.
- `requireReferenceDocViewAccess` (renamed from `requireReferenceDocAccess`)
  still gates GET / DELETE.
- **Platform Admin remains explicitly blocked** from any commercial document
  surface, including the new POST endpoint.
- **Factory User and Subcontractor User** remain blocked. Vendor portal
  pages do not import or render documents at all (verified by grep).
- Audit events still fire on every upload with `uploadedByRole`.

End result: Commercial Staff can attach the PO + Pricing Quotation during
the create flow, then **cannot list or download them**. Senior Management
remains the sole reader.

## Files changed

- `client/src/pages/home.tsx`
  - New `PreRfqUploadBox` component — shared drag-and-drop dropzone.
  - Rewritten `ProductManufacturingPoFields` with both boxes, suggestion
    card, Apply / Apply-all buttons, and lifted file state.
  - Lifted `pricingQuoteFile` / `poFile` state to `Home`, plus a
    post-create attach helper (`attachPreRfqDocuments`) and an attachment
    status banner.
  - Fixed the partnerClient Select — controlled only when the value
    matches a SelectItem.
- `server/routes.ts`
  - Split `requireReferenceDocAccess` into upload + view variants.
- `shared/roles.ts`
  - Added `RolePerms.canUploadReferenceDocuments`.

## Tests

- `npm run check` — clean.
- `npm run build` — succeeds.
- Playwright QA (Commercial Staff, Senior Management, Platform Admin,
  Factory User):
  - Drag-and-drop attribute toggles correctly.
  - PO upload of `50002911.pdf` returns confidence: high with three
    matched fields. "Apply all" populates Partner / Client, Country, and
    Customer. Direct typing into the partner field is no longer wiped.
  - Submit creates RFQ MFG-2026-0001. Both files attach successfully.
    The success toast and the in-form banner both confirm.
  - Senior Management `GET /api/rfqs/2/documents` → 200 with both files.
  - Commercial Staff `GET /api/rfqs/2/documents` → 403.
  - Platform Admin `GET` and `POST` → 403.
  - Factory User `GET` and `POST` → 403.
  - Commercial Staff `POST` → 201.
  - Garbage-file upload triggers the `text-po-extract-manual-needed`
    notice with the friendly amber message.
  - Mobile (375 × 812) renders both boxes stacked, no overflow.

Screenshots saved in repo root as `qa-pre-rfq-1-…` through
`qa-pre-rfq-8-…`.

## Known limitations / next steps

- The customer name extracted from the sample PO (`Kwekerij Helderman
  Middenmeer Wagenpad 4`) still includes the trailing address fragment.
  That's a heuristic-extractor concern, untouched by this change.
- Files are stored as base64 in SQLite. The 15 MB cap is enforced both
  client-side and server-side. No multipart upload, no chunked storage.
- Attach happens after the RFQ insert returns. There is a small window
  where the RFQ exists but documents are still uploading. The status
  banner makes that explicit and a failure path is logged but recoverable.

## Commit

`0bb92c8` — `feat: pre-RFQ Pricing Quotation + PO uploads with drag-and-drop and apply-extracted suggestions`
