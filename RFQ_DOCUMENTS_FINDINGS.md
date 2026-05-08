# RFQ reference documents — implementation findings

## Status
- **TypeScript check (`npm run check`):** pass
- **Production build (`npm run build`):** pass
- **API permission QA (curl):** pass — admin can CRUD; buyer / factory_user / subcontractor_user → 403; portal endpoint omits documents.
- **Browser QA (Playwright):** pass — admin sees panel and can upload/list/download/delete; buyer & factory_user see no panel; subcontractor portal contains no document fields, names, or download links.
- **Existing escalation/portal flow:** still works (verified token portal still loads invite detail unchanged).
- **Deployed:** asset id `a6f68786-37b1-4f7c-bea9-009f9f5762c6` (same site as before, redeployed).
- **Commit hash:** `7949f02` — "Add admin-only RFQ reference documents (PO + pricing quotation)"

## Files changed
| File | Change |
|---|---|
| `shared/schema.ts` | New `rfqDocuments` table + types `RfqDocument`, `RfqDocumentMeta`, `RfqDocumentType`, and `insertRfqDocumentSchema` (Zod). |
| `server/storage.ts` | New rfq_documents CREATE TABLE; methods `listRfqDocuments`, `getRfqDocument`, `saveRfqDocument`, `deleteRfqDocument`; metadata projection strips base64 from list responses. |
| `server/routes.ts` | New endpoints: `GET /api/rfqs/:id/documents`, `POST /api/rfqs/:id/documents`, `GET /api/rfqs/:id/documents/:documentId` (json or `?download=1` binary), `DELETE /api/rfqs/:id/documents/:documentId`. All guarded by `requireAdmin` (group_admin only). Subcontractor middleware already blocks tokenized clients. Portal endpoint unchanged. |
| `server/index.ts` | Express JSON / urlencoded body limit raised to `25mb` to accept the base64 payload (~20MB for a 15MB binary cap). |
| `client/src/lib/queryClient.ts` | Exported `API_BASE` so the documents panel can build absolute URLs for binary fetches that go through the deploy proxy. |
| `client/src/components/rfq-documents-panel.tsx` | New admin-only panel: two slots (Purchase Order, Pricing Quotation), file input → base64 upload via `apiRequest`, blob-download via `fetch` + `URL.createObjectURL`, delete control. Returns null for non-admins. |
| `client/src/pages/home.tsx` | Imports panel; renders inside the RFQ detail card only when `role === "group_admin"`. |
| `IMPLEMENTATION_SUMMARY.md` | Pre-existing local file, now committed alongside this feature. |

## Permission matrix
| Endpoint | group_admin | buyer | factory_user | subcontractor_user |
|---|---|---|---|---|
| `GET /api/rfqs/:id/documents` | 200 | **403** | **403** | **403** (subcontractor middleware) |
| `POST /api/rfqs/:id/documents` | 201 | **403** | **403** | **403** |
| `GET /api/rfqs/:id/documents/:docId` | 200 (json or binary) | **403** | **403** | **403** |
| `DELETE /api/rfqs/:id/documents/:docId` | 200 | **403** | **403** | **403** |
| `GET /api/portal/:token` | 200 — **never returns documents** | | | |
| `GET /api/rfqs/:id` | unchanged — **does not embed documents** | | | |

## Storage approach
SQLite blob via base64 text column on `rfq_documents`. Listed responses project away `contentBase64`. No new npm dependency (avoided multer). Files capped at 15MB per upload; common docs/PDF/Office/image/text MIME types accepted by the file picker; server enforces size only.

## Test IDs (stable)
- `card-rfq-documents`
- `section-document-purchase_order`, `section-document-pricing_quotation`
- `input-upload-purchase_order`, `input-upload-pricing_quotation`
- `button-upload-purchase_order`, `button-upload-pricing_quotation`
- `list-documents-purchase_order`, `list-documents-pricing_quotation`
- `row-document-{id}`, `text-document-name-{id}`, `link-download-document-{id}`, `button-delete-document-{id}`
- `text-documents-loading`, `text-documents-empty`

## Versioning
Multiple uploads of the same `documentType` are kept side-by-side (newer first). The "Upload new version" label appears once at least one document of that type exists. Admins can delete older versions individually.

## Known limitations
- Demo-only auth header role; no real auth boundary. Same security model as the rest of the app.
- Files stored as base64 text in SQLite — fine for the demo footprint and survives redeploys (data.db is the canonical store), but not optimal for large attachments.
