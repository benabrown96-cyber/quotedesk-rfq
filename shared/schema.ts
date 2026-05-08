import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const REQUEST_TYPES = ["external_rfq", "internal_etd", "intercompany"] as const;
export const RECIPIENT_TYPES = ["external_subcontractor", "internal_factory", "internal_company"] as const;

// RFQ category / section. Distinguishes manufacturing-subcontractor work from
// material/supply purchases (pallets, polythene bags, cardboard cartons, packaging,
// logistics, miscellaneous suppliers). Internal ETD-only and intercompany requests
// implicitly belong to the manufacturing_subcontractor section because they sit on
// the production side of TEG's supply chain.
export const RFQ_CATEGORIES = [
  "manufacturing_subcontractor",
  "wooden_pallets",
  "polythene_bags",
  "cardboard",
  "packaging_materials",
  "logistics_shipping",
  "other_supplies",
] as const;
export type RfqCategory = (typeof RFQ_CATEGORIES)[number];

// Workflow type controls how an RFQ is processed end-to-end.
//   standard_rfq           — normal price/ETD negotiation, lowest-price award.
//   price_validity_inquiry — supplier submits a price valid for N months (default 6).
//                            Acceptance records the validity, NOT a single product order.
//                            POs are issued later when actual quantities are required.
//                            Used for cardboard / wooden pallets.
//   polybag_rfq            — polythene bag inquiry. Requires bag size, gauge, quantity, ETD.
//                            Suppliers respond with price (USD) + ETD; TEG selects lowest /
//                            renegotiates as in a standard RFQ.
export const WORKFLOW_TYPES = [
  "standard_rfq",
  "price_validity_inquiry",
  "polybag_rfq",
] as const;
export type WorkflowType = (typeof WORKFLOW_TYPES)[number];

// Default price validity (months) used when a price_validity_inquiry RFQ is created
// without an explicit window. The user requirement is 6 months.
export const DEFAULT_PRICE_VALIDITY_MONTHS = 6;

// Map an RFQ category to its operations workflow.
// Wooden pallets and cardboard are price-validity inquiries (suppliers submit a
// price valid for ~6 months; POs follow later). Polythene bags are a polybag RFQ
// (specs-driven inquiry with normal lowest-price comparison). Everything else uses
// the standard RFQ flow.
export function workflowForCategory(category: RfqCategory): WorkflowType {
  if (category === "wooden_pallets" || category === "cardboard") return "price_validity_inquiry";
  if (category === "polythene_bags") return "polybag_rfq";
  return "standard_rfq";
}

// Materials side / managing team. Wooden pallets are always factory-managed; commercial
// staff cannot create or own pallet RFQs. Cardboard (price-validity) is currently kept
// on the commercial side because the inquiry is driven by the commercial team — open
// product question with operations.
export const MATERIAL_OWNER_TEAMS = ["commercial", "factory"] as const;
export type MaterialOwnerTeam = (typeof MATERIAL_OWNER_TEAMS)[number];
export function ownerTeamForCategory(category: RfqCategory): MaterialOwnerTeam {
  if (category === "wooden_pallets") return "factory";
  return "commercial";
}

export const RFQ_CATEGORY_META: Record<
  RfqCategory,
  { label: string; shortLabel: string; description: string; vendorNoun: string; rfqNoun: string }
> = {
  manufacturing_subcontractor: {
    label: "Product Manufacturing (Subcontractor)",
    shortLabel: "Product Manufacturing",
    description:
      "Finished-product manufacturing — Growbags, Grow pots, Bales/Blocks, or Baggers — routed to external manufacturing subcontractors, internal factories, or intercompany producers. Splits across multiple production locations are supported when one order needs more than one site.",
    vendorNoun: "manufacturing subcontractor",
    rfqNoun: "Product Manufacturing RFQ",
  },
  wooden_pallets: {
    label: "Wooden Pallets (Factory-managed)",
    shortLabel: "Pallets",
    description:
      "Pallet supply (wooden / heat-treated / fumigated). Handled by the factory team via a 6-month price-validity inquiry; PO issued later when required. Hidden from the commercial RFQ flow.",
    vendorNoun: "pallet supplier",
    rfqNoun: "Pallet price-validity inquiry",
  },
  polythene_bags: {
    label: "Polythene Bags",
    shortLabel: "Poly bags",
    description:
      "Poly bag inquiry (bag size, gauge, quantity, ETD required). Suppliers come back with price; TEG picks the lowest and renegotiates as needed.",
    vendorNoun: "poly bag supplier",
    rfqNoun: "Poly bag inquiry",
  },
  cardboard: {
    label: "Cardboard / Cartons",
    shortLabel: "Cardboard",
    description:
      "Corrugated cardboard / cartons. 6-month price-validity inquiry — supplier price is recorded and remains valid for 6 months; PO issued later when stock is required.",
    vendorNoun: "cardboard supplier",
    rfqNoun: "Cardboard price-validity inquiry",
  },
  packaging_materials: {
    label: "Packaging Materials",
    shortLabel: "Packaging",
    description: "Other packaging consumables — strapping, corner-protectors, tape, labels, stretch-wrap.",
    vendorNoun: "packaging supplier",
    rfqNoun: "Packaging supplier RFQ",
  },
  logistics_shipping: {
    label: "Logistics / Shipping",
    shortLabel: "Logistics",
    description: "Freight, container haulage, forwarding, port handling, and last-mile shipping vendors.",
    vendorNoun: "logistics provider",
    rfqNoun: "Logistics RFQ",
  },
  other_supplies: {
    label: "Other Suppliers",
    shortLabel: "Other",
    description: "Any other supplier RFQ that doesn't fit the named categories.",
    vendorNoun: "supplier",
    rfqNoun: "Supplier RFQ",
  },
};

// Vendor type. Existing rows live in the `subcontractors` table for back-compat;
// the column distinguishes manufacturing subcontractors (negotiation, factory-style
// production work) from material/service suppliers (pallets, packaging, logistics, etc.).
export const VENDOR_TYPES = ["manufacturing_subcontractor", "supplier"] as const;
export type VendorType = (typeof VENDOR_TYPES)[number];

export function defaultCategoryForVendorType(vendorType: VendorType): RfqCategory {
  return vendorType === "manufacturing_subcontractor" ? "manufacturing_subcontractor" : "other_supplies";
}

export function vendorTypeForCategory(category: RfqCategory): VendorType {
  return category === "manufacturing_subcontractor" ? "manufacturing_subcontractor" : "supplier";
}
export const PRICE_VISIBILITY = ["visible", "hidden"] as const;
export const NEGOTIATION_SCOPES = ["price_etd", "etd_only"] as const;
export const COUNTRIES = ["Sri Lanka", "India", "Indonesia"] as const;
export const RFQ_DOCUMENT_TYPES = ["purchase_order", "pricing_quotation"] as const;
export type RfqDocumentType = (typeof RFQ_DOCUMENT_TYPES)[number];

// All TEG companies operate in USD because TEG is an export company.
// Centralizing this here makes the assumption explicit and future-proofs the schema
// in case multi-currency support becomes needed (we'd add a per-RFQ currency column then).
export const DEFAULT_CURRENCY = "USD" as const;

// Default response window when an RFQ is created without an explicit responseDue.
// Stored in the settings table; this is the boot-time default if settings are missing.
// Default is 1 calendar day (~24 hours). The setting remains configurable — Senior
// Management / Platform Admin can switch to a longer window or business-day mode
// from the System Settings panel.
export const DEFAULT_RFQ_RESPONSE_DAYS = 1;
// Backwards-compatible alias kept for any importers still using the old name.
export const DEFAULT_RFQ_RESPONSE_BUSINESS_DAYS = DEFAULT_RFQ_RESPONSE_DAYS;
// Default portal token expiry. Aligned with RFQ response window (1 day = 24 hours).
export const DEFAULT_TOKEN_EXPIRY_BUSINESS_DAYS = 1;

// Response window day-mode: business days (skip weekends) or calendar days.
export const RESPONSE_DAY_MODES = ["business", "calendar"] as const;
export type ResponseDayMode = (typeof RESPONSE_DAY_MODES)[number];
// Default to calendar so a 24-hour window does not skip weekends. Configurable.
export const DEFAULT_RESPONSE_DAY_MODE: ResponseDayMode = "calendar";

// Deal close window — overall RFQ close/award target, distinct from the initial
// response window. The user rule: "the deal should be closed within 7 days from RFQ
// creation." Stored alongside the response-window settings so Senior Management /
// Platform Admin can adjust both from the system settings panel. Calendar by default.
export const DEFAULT_DEAL_CLOSE_DAYS = 7;
export const DEFAULT_DEAL_CLOSE_DAY_MODE: ResponseDayMode = "calendar";

// Cluster identifiers (display names match company.clusterName).
export const CLUSTERS = ["Tropicoir / Premier Tech", "Euro / Growrite"] as const;
export type ClusterName = (typeof CLUSTERS)[number];

// Statuses that indicate active negotiation — expiry is paused/extended while in these states.
export const ACTIVE_NEGOTIATION_STATUSES = [
  "under_negotiation",
  "quoted",
  "countered",
  "responded",
] as const;

export const AUDIT_EVENT_TYPES = [
  "rfq_created",
  "rfq_updated",
  "rfq_amended",
  "rfq_amendment_recorded",
  "invite_sent",
  "invites_bulk_sent",
  "quote_submitted",
  "etd_submitted",
  "buyer_counter",
  "recommendation_submitted",
  "recommendation_decided",
  "award_approved",
  "rfq_closed",
  "rfq_expired",
  "document_uploaded",
  "document_deleted",
  "user_grant_changed",
  "user_active_changed",
  "user_role_changed",
  "token_revoked",
  "token_extended",
  "settings_changed",
  "subcontractor_cluster_access_changed",
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export const AWARD_RECOMMENDATION_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "returned",
] as const;
export type AwardRecommendationStatus = (typeof AWARD_RECOMMENDATION_STATUSES)[number];

// Email-style in-app notifications. Nothing here is ever sent over real email or SMS;
// these rows back the notification center / event feed inside the app.
export const NOTIFICATION_TYPES = [
  "rfq_sent",
  "rfq_updated",
  "quote_received",
  "recommendation_pending",
  "award_approved",
  "award_closure",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// Audience scope describes WHO should see this notification.
// `admin_internal` — group_admin only (most sensitive: PO/pricing context summaries, recommendation review).
// `admin_buyer_commercial` — group_admin + relevant buyer + commercial_staff in the cluster.
// `factory` — internal factory user assigned to the invite (no price).
// `subcontractor_invite` — token-portal subcontractor for that invite (no admin docs / recommendations).
export const USER_TYPES = ["internal", "external"] as const;
export type UserType = (typeof USER_TYPES)[number];

export const AUTH_PROVIDERS = ["microsoft", "google", "magic_link", "demo"] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export const SCOPE_TYPES = ["none", "company", "factory", "subcontractor", "cluster"] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export const NOTIFICATION_AUDIENCES = [
  "admin_internal",
  "admin_buyer_commercial",
  "factory",
  "subcontractor_invite",
] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  clusterName: text("cluster_name").notNull(),
  code: text("code").notNull().unique(),
  createdAt: text("created_at").notNull(),
});

export const factories = sqliteTable("factories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id").notNull(),
  name: text("name").notNull(),
  country: text("country").notNull().default("Sri Lanka"),
  location: text("location").notNull(),
  createdAt: text("created_at").notNull(),
});

export const subcontractors = sqliteTable("subcontractors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  contactName: text("contact_name").notNull(),
  email: text("email").notNull(),
  specialty: text("specialty").notNull(),
  country: text("country").notNull().default("Sri Lanka"),
  rating: text("rating").notNull().default("Preferred"),
  // JSON-encoded array of cluster names this subcontractor is available to.
  // Empty / null = available to BOTH clusters (legacy default).
  clusterAccess: text("cluster_access").notNull().default("[]"),
  // Distinguishes manufacturing subcontractors from material/service suppliers.
  // Existing rows are back-filled to "manufacturing_subcontractor" so legacy flows continue.
  vendorType: text("vendor_type").notNull().default("manufacturing_subcontractor"),
  // JSON-encoded array of RFQ categories this vendor can be invited to. Empty = inferred
  // from vendorType (manufacturing_subcontractor → [manufacturing_subcontractor]; supplier
  // with no explicit list = [other_supplies]). The vendor picker filters by RFQ category.
  supportedCategories: text("supported_categories").notNull().default("[]"),
  // Free-form description of materials / services offered. Used for portal copy.
  materialsSupplied: text("materials_supplied"),
  createdAt: text("created_at").notNull(),
});

// System settings — single-row keyed config. Senior Management / Platform Admin can edit.
// Deal close fields control the overall RFQ close-by deadline (default 7 calendar days
// from creation), kept separate from the initial response window above.
export const systemSettings = sqliteTable("system_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  responseDefaultDays: integer("response_default_days").notNull().default(1),
  responseDayMode: text("response_day_mode").notNull().default("calendar"),
  dealCloseDefaultDays: integer("deal_close_default_days").notNull().default(7),
  dealCloseDayMode: text("deal_close_day_mode").notNull().default("calendar"),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by"),
});

export const rfqs = sqliteTable("rfqs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reference: text("reference").notNull().unique(),
  requestType: text("request_type").notNull().default("external_rfq"),
  // RFQ category / section. Drives dashboard tabs, vendor picker filter, and copy.
  category: text("category").notNull().default("manufacturing_subcontractor"),
  requestingCompanyId: integer("requesting_company_id").notNull().default(1),
  producingCompanyId: integer("producing_company_id"),
  producingFactoryId: integer("producing_factory_id"),
  clusterName: text("cluster_name").notNull().default("Tropicoir / Premier Tech"),
  priceVisibility: text("price_visibility").notNull().default("visible"),
  negotiationScope: text("negotiation_scope").notNull().default("price_etd"),
  escalationSourceRfqId: integer("escalation_source_rfq_id"),
  escalationReason: text("escalation_reason"),
  projectName: text("project_name").notNull(),
  packageName: text("package_name").notNull(),
  description: text("description").notNull(),
  quantity: text("quantity").notNull(),
  unit: text("unit").notNull(),
  targetEtd: text("target_etd").notNull(),
  responseDue: text("response_due").notNull(),
  // Computed/manual expiry deadline; defaults align with responseDue but admin can extend.
  expiresAt: text("expires_at"),
  // Deal close target — the overall close/award deadline, distinct from responseDue
  // (which is the initial response window). User rule: deals should be closed within
  // 7 days from RFQ creation. Stored as ISO datetime; backfilled to createdAt + 7d for
  // legacy rows. Awarded/closed/accepted RFQs are not flagged overdue.
  dealCloseDue: text("deal_close_due"),
  status: text("status").notNull().default("draft"),
  awardedInviteId: integer("awarded_invite_id"),
  awardedAt: text("awarded_at"),
  // Workflow type (standard_rfq | price_validity_inquiry | polybag_rfq). Derived from
  // category at create time; persisted so legacy rows stay consistent if category meta moves.
  workflowType: text("workflow_type").notNull().default("standard_rfq"),
  // Price validity window in months. Only meaningful for price_validity_inquiry workflow.
  // Default of 6 months matches the operations rule for cardboard / wooden pallets.
  priceValidityMonths: integer("price_validity_months"),
  // JSON-encoded material spec metadata. Currently used by polybag_rfq to store
  // { bagSize, gauge, etdRequired } so the create form, register, and supplier portal
  // can display the inquiry details without changing the core RFQ schema.
  materialSpecs: text("material_specs").notNull().default("{}"),
  // Product Manufacturing-only commercial context. Captured when the RFQ is created
  // because Product Manufacturing RFQs are sent only after a price quotation is
  // produced and a Purchase Order is received from the partner/client. Non-manufacturing
  // categories ignore these columns and leave them blank.
  //   partnerClient — partner or client that issued the PO (specific to a TEG company / cluster).
  //   poCountry     — country of the partner/client (informational; UI surface).
  //   poCustomerName — the end-customer named on the PO (often differs from the partner).
  partnerClient: text("partner_client"),
  poCountry: text("po_country"),
  poCustomerName: text("po_customer_name"),
  createdAt: text("created_at").notNull(),
});

// Partner / client master data per TEG company cluster. Two clusters use different
// partner books today: Tropicoir / Premier Tech vs. Euro / Growrite. The picker on
// the create-RFQ form filters partners by the selected requesting company's cluster,
// but the Product Manufacturing form also accepts free-text entry so a previously
// unseen partner can be captured without master-data setup.
export const partnerClients = sqliteTable("partner_clients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  country: text("country").notNull(),
  clusterName: text("cluster_name").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
});
export type PartnerClient = typeof partnerClients.$inferSelect;

export const rfqInvites = sqliteTable("rfq_invites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  rfqId: integer("rfq_id").notNull(),
  recipientType: text("recipient_type").notNull().default("external_subcontractor"),
  subcontractorId: integer("subcontractor_id"),
  factoryId: integer("factory_id"),
  companyId: integer("company_id"),
  country: text("country").notNull().default("Sri Lanka"),
  priceVisibility: text("price_visibility").notNull().default("visible"),
  negotiationScope: text("negotiation_scope").notNull().default("price_etd"),
  token: text("token").notNull().unique(),
  status: text("status").notNull().default("sent"),
  currentPrice: integer("current_price"),
  currentEtd: text("current_etd"),
  lastNote: text("last_note"),
  closureReason: text("closure_reason"),
  closedAt: text("closed_at"),
  // Token security — controls portal access for the invite.
  tokenExpiresAt: text("token_expires_at"),
  tokenRevokedAt: text("token_revoked_at"),
  lastAccessedAt: text("last_accessed_at"),
  accessCount: integer("access_count").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});

export const rfqDocuments = sqliteTable("rfq_documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  rfqId: integer("rfq_id").notNull(),
  documentType: text("document_type").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  contentBase64: text("content_base64").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  uploadedByRole: text("uploaded_by_role").notNull(),
  uploadedAt: text("uploaded_at").notNull(),
});

export const auditEvents = sqliteTable("audit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventType: text("event_type").notNull(),
  rfqId: integer("rfq_id"),
  inviteId: integer("invite_id"),
  recommendationId: integer("recommendation_id"),
  documentId: integer("document_id"),
  actorUserId: integer("actor_user_id"),
  actorRole: text("actor_role").notNull(),
  actorLabel: text("actor_label").notNull(),
  action: text("action").notNull(),
  summary: text("summary").notNull(),
  // Free-form metadata; JSON stringified.
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
});

export const awardRecommendations = sqliteTable("award_recommendations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  rfqId: integer("rfq_id").notNull(),
  inviteId: integer("invite_id").notNull(),
  status: text("status").notNull().default("pending"),
  recommendedByRole: text("recommended_by_role").notNull(),
  recommendedBy: text("recommended_by"),
  rationale: text("rationale").notNull(),
  proposedClosureReason: text("proposed_closure_reason"),
  decisionNote: text("decision_note"),
  decidedByRole: text("decided_by_role"),
  createdAt: text("created_at").notNull(),
  decidedAt: text("decided_at"),
});

// RFQ amendment / version history. Each row represents a structured revision of
// the RFQ — Rev 0 is the baseline created at RFQ creation time, Rev 1+ are written
// when an RFQ is edited via PATCH /api/rfqs/:id. The internal record holds full
// before/after snapshots in `changedFields`; the portal-safe view exposes only the
// revision number, date, and a generic safe summary so vendors / factories don't
// see internal admin-only fields, pricing context, or comparison data.
export const rfqAmendments = sqliteTable("rfq_amendments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  rfqId: integer("rfq_id").notNull(),
  revisionNumber: integer("revision_number").notNull(),
  changedBy: text("changed_by").notNull(),
  changedByRole: text("changed_by_role").notNull(),
  // Optional reason supplied by the editor in the Edit RFQ form. When omitted
  // we synthesize a summary from changedFields.
  reason: text("reason"),
  // Short safe summary for vendors/factories. Strips internal/admin/pricing fields.
  safeSummary: text("safe_summary").notNull(),
  // Full internal summary used by senior management / commercial roles.
  internalSummary: text("internal_summary").notNull(),
  // JSON-encoded array of { field, before, after } records. Sensitive values are
  // never stored here for fields that the portal might receive — admin-only
  // documents and reference filenames are explicitly excluded upstream.
  changedFields: text("changed_fields").notNull().default("[]"),
  notifiedRecipients: integer("notified_recipients").notNull().default(0),
  createdAt: text("created_at").notNull(),
});
export type RfqAmendmentRow = typeof rfqAmendments.$inferSelect;
export type RfqAmendmentChangedField = {
  field: string;
  before: unknown;
  after: unknown;
};
export type RfqAmendment = Omit<RfqAmendmentRow, "changedFields"> & {
  changedFields: RfqAmendmentChangedField[];
};
// Portal-safe shape — the slim view safe to send to subcontractors/factories.
export type RfqAmendmentSafe = {
  id: number;
  rfqId: number;
  revisionNumber: number;
  safeSummary: string;
  createdAt: string;
};

export function parseAmendmentChangedFields(raw: string | null | undefined): RfqAmendmentChangedField[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row: any) => row && typeof row === "object" && typeof row.field === "string")
      .map((row: any) => ({
        field: row.field,
        before: row.before === undefined ? null : row.before,
        after: row.after === undefined ? null : row.after,
      }));
  } catch {
    return [];
  }
}

// Required commercial documents for Product Manufacturing RFQs.
// Both must be attached BEFORE invites can be sent (single + bulk) and BEFORE an
// award or recommendation approval can be finalised. Non-manufacturing categories
// are not blocked. Filenames / metadata are NEVER exposed via portal endpoints —
// the client receives only present/missing booleans for the checklist UI.
export const REQUIRED_MFG_DOC_TYPES: RfqDocumentType[] = [
  "purchase_order",
  "pricing_quotation",
];

export type DocumentRequirementStatus = {
  // True when the RFQ category requires the documents (Product Manufacturing).
  required: boolean;
  // True when every required doc has at least one attached file.
  satisfied: boolean;
  // For each required doc type — has it been attached?
  byType: { documentType: RfqDocumentType; present: boolean }[];
  // Helper for the UI: list of human-readable missing labels.
  missingLabels: string[];
};

export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  rfqId: integer("rfq_id").notNull(),
  inviteId: integer("invite_id"),
  recommendationId: integer("recommendation_id"),
  notificationType: text("notification_type").notNull(),
  audience: text("audience").notNull(),
  // Optional fine-grained scope: companyId for buyer/commercial scope, factoryId for factory user, inviteId for portal token holder.
  audienceCompanyId: integer("audience_company_id"),
  audienceFactoryId: integer("audience_factory_id"),
  audienceInviteId: integer("audience_invite_id"),
  // Display label for the audience, e.g. "TEG admin", "Buyer · Tropicoir Lanka".
  recipientLabel: text("recipient_label").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  // We track read state per-role rather than per-user to keep this demo simple.
  // JSON object keyed by role name -> ISO timestamp.
  readByRoles: text("read_by_roles").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
});

// User directory — auth-ready. The preview uses demo accounts only; production wiring is
// described in AUTHENTICATION_SETUP.md. authProvider is informational in the preview.
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  userType: text("user_type").notNull().default("internal"),
  authProvider: text("auth_provider").notNull().default("demo"),
  role: text("role").notNull(),
  scopeType: text("scope_type").notNull().default("none"),
  scopeId: integer("scope_id"),
  companyId: integer("company_id"),
  factoryId: integer("factory_id"),
  subcontractorId: integer("subcontractor_id"),
  clusterName: text("cluster_name"),
  // Legacy single grant — kept for back-compat. When true and granular fields are unset, all three are inferred true.
  commercialGrant: integer("commercial_grant", { mode: "boolean" }).notNull().default(false),
  // Granular commercial-staff permissions. Buyers / admins ignore these.
  canSendRfqs: integer("can_send_rfqs", { mode: "boolean" }).notNull().default(false),
  canNegotiate: integer("can_negotiate", { mode: "boolean" }).notNull().default(false),
  canRecommendAwards: integer("can_recommend_awards", { mode: "boolean" }).notNull().default(false),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at").notNull(),
});

export const negotiations = sqliteTable("negotiations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  inviteId: integer("invite_id").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  price: integer("price"),
  etd: text("etd"),
  note: text("note").notNull(),
  createdAt: text("created_at").notNull(),
});

export const insertSubcontractorSchema = createInsertSchema(subcontractors)
  .omit({
    id: true,
    createdAt: true,
    clusterAccess: true,
    supportedCategories: true,
  })
  .extend({
    country: z.enum(COUNTRIES),
    // List of cluster names available. Empty array = both clusters (default).
    clusterAccess: z.array(z.enum(CLUSTERS)).optional().default([]),
    vendorType: z.enum(VENDOR_TYPES).optional().default("manufacturing_subcontractor"),
    supportedCategories: z.array(z.enum(RFQ_CATEGORIES)).optional().default([]),
    materialsSupplied: z.string().max(2000).optional().nullable(),
  });

export const updateSubcontractorClusterAccessSchema = z.object({
  clusterAccess: z.array(z.enum(CLUSTERS)),
});
export type UpdateSubcontractorClusterAccess = z.infer<typeof updateSubcontractorClusterAccessSchema>;

export const updateSettingsSchema = z.object({
  responseDefaultDays: z.coerce.number().int().min(1).max(60).optional(),
  responseDayMode: z.enum(RESPONSE_DAY_MODES).optional(),
  dealCloseDefaultDays: z.coerce.number().int().min(1).max(180).optional(),
  dealCloseDayMode: z.enum(RESPONSE_DAY_MODES).optional(),
});
export type UpdateSettings = z.infer<typeof updateSettingsSchema>;

// Dimension triple — used for both marketed and actual polybag sizes. Stored as strings
// so users can include units (e.g. "40 cm", "15 in") rather than enforcing a single unit.
export const dimensionsSchema = z.object({
  length: z.string().min(1, "Length is required"),
  width: z.string().min(1, "Width is required"),
  height: z.string().min(1, "Height is required"),
});
export type Dimensions = z.infer<typeof dimensionsSchema>;

// Polybag-specific spec fields. Required for the polybag_rfq workflow only.
// Now includes BOTH a marketed/market size (what the customer or distributor calls it)
// and an actual bag size (the manufacturing dimensions the supplier needs to make to).
// Each size carries Length, Width, and Height. Legacy bagSize string is preserved
// for back-compat reads but is no longer required on new submissions.
export const polybagSpecsSchema = z.object({
  marketedSize: dimensionsSchema,
  actualSize: dimensionsSchema,
  gauge: z.string().min(1, "Gauge is required"),
  etdRequired: z.string().min(1, "ETD required is required"),
  // Legacy single-string size kept optional for older rows.
  bagSize: z.string().optional().nullable(),
});
export type PolybagSpecs = z.infer<typeof polybagSpecsSchema>;

// Manufacturing product types. Selected from a dropdown when category=Product Manufacturing.
//   growbags, grow_pots — "Product Size" is a physical dimension (e.g. 40x20x10 cm).
//   bales_blocks, baggers — "Product Size" is treated as Weight (e.g. 5 kg, 25 lb).
// productSize remains the storage field; the UI labels it Weight for size-as-weight types.
export const MANUFACTURING_PRODUCT_TYPES = [
  "growbags",
  "grow_pots",
  "bales_blocks",
  "baggers",
] as const;
export type ManufacturingProductType = (typeof MANUFACTURING_PRODUCT_TYPES)[number];

export const MANUFACTURING_PRODUCT_TYPE_META: Record<
  ManufacturingProductType,
  { label: string; sizeLabel: string; sizeHelp: string; placeholder: string }
> = {
  growbags: {
    label: "Growbags",
    sizeLabel: "Product size",
    sizeHelp: "Bag dimensions (e.g. 40 x 20 x 10 cm).",
    placeholder: "e.g. 40x20x10 cm",
  },
  grow_pots: {
    label: "Grow pots",
    sizeLabel: "Product size",
    sizeHelp: "Pot dimensions or volume (e.g. 5 L pot).",
    placeholder: "e.g. 5 L pot, 20 cm dia",
  },
  bales_blocks: {
    label: "Bales / Blocks",
    sizeLabel: "Weight",
    sizeHelp: "Product size for bales/blocks is the unit weight (e.g. 5 kg block, 5 kg bale).",
    placeholder: "e.g. 5 kg block",
  },
  baggers: {
    label: "Baggers",
    sizeLabel: "Weight",
    sizeHelp: "Product size for baggers is the unit weight (e.g. 25 kg bag).",
    placeholder: "e.g. 25 kg bag",
  },
};

export function isWeightProductType(t?: ManufacturingProductType | null): boolean {
  return t === "bales_blocks" || t === "baggers";
}

// Manufacturing-specific spec fields. Required for external manufacturing_subcontractor
// RFQs going to outside vendors. Internal ETD / intercompany requests may omit these
// (legacy rows allowed) but the create form will encourage them.
//
// productType is optional on legacy rows; new manufacturing RFQs require it. The label of
// productSize switches to "Weight" when productType is bales_blocks or baggers — see
// MANUFACTURING_PRODUCT_TYPE_META.
export const manufacturingSpecsSchema = z.object({
  materialSpecification: z.string().min(1, "Material specification is required"),
  productSize: z.string().min(1, "Product size is required"),
  ecLevel: z.string().min(1, "EC level is required"),
  productType: z.enum(MANUFACTURING_PRODUCT_TYPES).optional().nullable(),
});
export type ManufacturingSpecs = z.infer<typeof manufacturingSpecsSchema>;

// One product line on a Product Manufacturing RFQ. Multiple lines may be attached
// when a single RFQ covers more than one product. Stored under materialSpecs.productLines.
//
// productSize doubles as Weight when productType is bales_blocks/baggers (see
// MANUFACTURING_PRODUCT_TYPE_META). The UI relabels accordingly. Quantity is the
// product line's order quantity (e.g. "6 containers" or "15,000 bags"); loadability
// per container is the per-container fit (units/container) used during export. Both
// are stored as free-form strings so users can include units.
// Optional production-split rows. Used when one manufacturing product is to be produced
// at more than one location (split across factories or subcontractors). When provided
// the array MUST contain at least 2 rows (the user requirement: "more than one location").
// Rows are free-form: locationName + allocation (e.g. "60%", "100 units") + optional note.
// Splits live INSIDE a product line (productLine.productionSplits). RFQ-level
// productionSplits remain accepted only for legacy compatibility — they are still read
// by older clients and may be migrated to product line 1 on display.
export const productionSplitRowSchema = z.object({
  locationName: z.string().min(1, "Location name is required"),
  allocation: z.string().min(1, "Allocation is required"),
  note: z.string().optional().nullable(),
});
export type ProductionSplitRow = z.infer<typeof productionSplitRowSchema>;

export const productionSplitsSchema = z
  .array(productionSplitRowSchema)
  .min(2, "Add at least 2 split rows when splitting across multiple locations.");
export type ProductionSplits = z.infer<typeof productionSplitsSchema>;

export const productLineSchema = z.object({
  productType: z.enum(MANUFACTURING_PRODUCT_TYPES, {
    required_error: "Pick a product type",
  }),
  materialSpecification: z.string().min(1, "Material specification is required"),
  productSize: z.string().min(1, "Product size / weight is required"),
  ecLevel: z.string().min(1, "EC level is required"),
  quantity: z.string().min(1, "Quantity is required"),
  loadabilityPerContainer: z.string().min(1, "Loadability per container is required"),
  notes: z.string().optional().nullable(),
  // Optional per-product-line split. Different products may have different splits.
  // When supplied, must contain at least 2 rows (location + allocation each).
  productionSplits: productionSplitsSchema.optional().nullable(),
});
export type ProductLine = z.infer<typeof productLineSchema>;

export const productLinesSchema = z
  .array(productLineSchema)
  .min(1, "Add at least one product line");
export type ProductLines = z.infer<typeof productLinesSchema>;

export const insertRfqSchema = createInsertSchema(rfqs)
  .omit({
    id: true,
    status: true,
    createdAt: true,
    clusterName: true,
    priceVisibility: true,
    negotiationScope: true,
    escalationSourceRfqId: true,
    escalationReason: true,
    awardedInviteId: true,
    awardedAt: true,
    expiresAt: true,
    dealCloseDue: true,
    category: true,
    workflowType: true,
    priceValidityMonths: true,
    materialSpecs: true,
    // Server generates the reference (RFQ code) per category. Client may still pass
    // a value (for legacy compat) but it's optional and ignored when blank.
    reference: true,
  })
  .extend({
    requestType: z.enum(REQUEST_TYPES),
    category: z.enum(RFQ_CATEGORIES).optional().default("manufacturing_subcontractor"),
    requestingCompanyId: z.coerce.number().int().positive(),
    producingCompanyId: z.coerce.number().int().positive().optional().nullable(),
    producingFactoryId: z.coerce.number().int().positive().optional().nullable(),
    // Product Manufacturing replaces these legacy generic fields with Partner / PO Customer
    // (see partnerClient, poCustomerName below). They remain optional here so the create
    // request payload doesn't need to send Project / Order / Scope for manufacturing RFQs.
    // Non-manufacturing categories still require them; createRfq derives sensible values
    // for manufacturing creates so the underlying notNull columns stay populated.
    projectName: z.string().min(2).optional().nullable(),
    packageName: z.string().min(2).optional().nullable(),
    description: z.string().min(10).optional().nullable(),
    quantity: z.string().optional().nullable(),
    unit: z.string().optional().nullable(),
    targetEtd: z.string().min(1, "Target ETD is required"),
    // Allow empty / missing — server fills with default business-day window.
    responseDue: z.string().optional().nullable().transform((v) => (v && v.trim() ? v.trim() : "")),

    // Optional explicit override; otherwise derived server-side from category.
    priceValidityMonths: z.coerce.number().int().positive().max(60).optional().nullable(),
    // Polybag inquiry specs. Required only when category is polythene_bags.
    polybagSpecs: polybagSpecsSchema.optional().nullable(),
    // Manufacturing-subcontractor specs. Legacy single-product field — when productLines is
    // not supplied, this is normalized into a single product line server-side.
    manufacturingSpecs: manufacturingSpecsSchema.optional().nullable(),
    // Multi-product Product Manufacturing lines. Required for any Product Manufacturing
    // RFQ (external, internal_etd, intercompany). Legacy creates may submit a single
    // manufacturingSpecs + top-level quantity/unit which are normalized into one line.
    productLines: productLinesSchema.optional().nullable(),
    // Legacy RFQ-level production splits. NEW UI sends splits inside each product line
    // (productLine.productionSplits) instead. Accepted here only for backward compat.
    productionSplits: productionSplitsSchema.optional().nullable(),
    // Optional client-supplied reference. Server generates one when blank/missing.
    reference: z.string().optional().nullable(),
    // Product Manufacturing PO context. Required only when category === manufacturing_subcontractor.
    // Server enforces this; non-manufacturing creates leave the columns null.
    partnerClient: z.string().min(1).max(160).optional().nullable(),
    poCountry: z.string().min(1).max(80).optional().nullable(),
    poCustomerName: z.string().min(1).max(160).optional().nullable(),
  });

// PATCH /api/rfqs/:id schema. Edits to a sent RFQ only — limited safe fields.
// Category and requestType are intentionally NOT here when invites already exist;
// the route enforces that constraint server-side.
export const updateRfqSchema = z.object({
  projectName: z.string().min(2).optional(),
  packageName: z.string().min(2).optional(),
  description: z.string().min(10).optional(),
  quantity: z.string().min(1).optional(),
  unit: z.string().min(1).optional(),
  targetEtd: z.string().min(1).optional(),
  responseDue: z.string().optional().nullable(),
  priceValidityMonths: z.coerce.number().int().positive().max(60).optional().nullable(),
  polybagSpecs: polybagSpecsSchema.optional().nullable(),
  manufacturingSpecs: manufacturingSpecsSchema.optional().nullable(),
  // Replace the full product-line list when supplied. Min 1 row when present.
  productLines: productLinesSchema.optional().nullable(),
  // Legacy RFQ-level splits. New UI puts splits inside each product line. null clears
  // any existing RFQ-level splits; an array replaces them with min-2 validation.
  productionSplits: productionSplitsSchema.optional().nullable(),
  // Pre-invite only — server validates that no invites exist.
  category: z.enum(RFQ_CATEGORIES).optional(),
  requestType: z.enum(REQUEST_TYPES).optional(),
  requestingCompanyId: z.coerce.number().int().positive().optional(),
  producingCompanyId: z.coerce.number().int().positive().optional().nullable(),
  producingFactoryId: z.coerce.number().int().positive().optional().nullable(),
  // Product Manufacturing PO context — editable any time (subject to existing edit
  // restrictions). Sending null clears the value; sending a string replaces it.
  partnerClient: z.string().min(1).max(160).optional().nullable(),
  poCountry: z.string().min(1).max(80).optional().nullable(),
  poCustomerName: z.string().min(1).max(160).optional().nullable(),
  // Optional reason captured in the Edit RFQ panel. Recorded on the amendment row.
  // When omitted, the server synthesises a summary from changed fields. Never
  // exposed through the portal; only internal roles see it.
  amendmentReason: z
    .string()
    .max(500)
    .optional()
    .nullable()
    .transform((value) => (value === undefined || value === null ? null : value.trim() ? value.trim() : null)),
});
export type UpdateRfq = z.infer<typeof updateRfqSchema>;

// Schema used by /api/po-extract — accepts an uploaded PO (text or PDF, base64),
// runs heuristic parsing, and returns extracted Partner / Country / PO Customer plus
// confidence notes. The extraction is advisory; the create form lets the user edit
// every field before submitting.
export const poExtractRequestSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  contentBase64: z.string().min(1, "Empty file content"),
  // Hint the user-selected requesting cluster so we can rank partner-name candidates.
  clusterName: z.enum(CLUSTERS).optional().nullable(),
});
export type PoExtractRequest = z.infer<typeof poExtractRequestSchema>;

export type PoExtractResult = {
  partnerClient: string | null;
  poCountry: string | null;
  poCustomerName: string | null;
  confidence: "high" | "medium" | "low" | "none";
  matchedLabels: string[];
  notes: string[];
  // True when we could not pull any text — e.g. scanned/image-only PDFs.
  textExtractionFailed: boolean;
};

// Bulk invite schema. Sends the same RFQ to multiple recipients server-side.
// Country is informational/UI-side; server still enforces routing on each entry.
export const bulkInviteSchema = z.object({
  recipientType: z.enum(RECIPIENT_TYPES).optional().default("external_subcontractor"),
  country: z.string().optional().nullable(),
  subcontractorIds: z.array(z.coerce.number().int().positive()).optional().default([]),
  factoryIds: z.array(z.coerce.number().int().positive()).optional().default([]),
  companyIds: z.array(z.coerce.number().int().positive()).optional().default([]),
});
export type BulkInvite = z.infer<typeof bulkInviteSchema>;

// Category → RFQ code prefix. Codes are server-generated as `${PREFIX}-${YEAR}-${SEQ}`,
// e.g. POLY-2026-0007. Pre-existing references are preserved untouched on edit/read.
export const RFQ_CODE_PREFIX: Record<RfqCategory, string> = {
  manufacturing_subcontractor: "MFG",
  wooden_pallets: "PAL",
  polythene_bags: "POLY",
  cardboard: "CARD",
  packaging_materials: "PACK",
  logistics_shipping: "LOG",
  other_supplies: "OTH",
};

export const insertInviteSchema = z.object({
  recipientType: z.enum(RECIPIENT_TYPES),
  subcontractorId: z.coerce.number().int().positive().optional().nullable(),
  factoryId: z.coerce.number().int().positive().optional().nullable(),
  companyId: z.coerce.number().int().positive().optional().nullable(),
});

export const insertNegotiationSchema = createInsertSchema(negotiations)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    actor: z.enum(["buyer", "subcontractor", "factory"]),
    action: z.enum(["quote", "counter", "accept", "decline", "message", "escalate"]),
    price: z.coerce.number().int().positive().optional().nullable(),
    etd: z.string().optional().nullable(),
    note: z.string().min(1, "A note is required"),
  });

export type Company = typeof companies.$inferSelect;
export type Factory = typeof factories.$inferSelect;
export type SubcontractorRow = typeof subcontractors.$inferSelect;
export type Subcontractor = Omit<SubcontractorRow, "clusterAccess" | "supportedCategories"> & {
  // Hydrated parsed list. Empty = both clusters.
  clusterAccess: string[];
  // Hydrated parsed list. Empty = inferred from vendorType.
  supportedCategories: RfqCategory[];
  vendorType: VendorType;
};
export type InsertSubcontractor = z.infer<typeof insertSubcontractorSchema>;

export type SystemSettingsRow = typeof systemSettings.$inferSelect;
export type SystemSettings = {
  responseDefaultDays: number;
  responseDayMode: ResponseDayMode;
  dealCloseDefaultDays: number;
  dealCloseDayMode: ResponseDayMode;
  updatedAt: string;
  updatedBy: string | null;
};
// `Rfq` keeps the raw DB row shape (materialSpecs as JSON-encoded string) for type
// compatibility with existing code paths. Use `parseMaterialSpecs(rfq.materialSpecs)`
// when reading; storage hydrates polybag specs into the response on read.
export type Rfq = typeof rfqs.$inferSelect;
export type InsertRfq = z.infer<typeof insertRfqSchema>;

export function parseMaterialSpecs(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readDimensions(value: unknown): Dimensions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const length = typeof obj.length === "string" ? obj.length : null;
  const width = typeof obj.width === "string" ? obj.width : null;
  const height = typeof obj.height === "string" ? obj.height : null;
  if (!length || !width || !height) return null;
  return { length, width, height };
}

export function readPolybagSpecs(raw: string | null | undefined): PolybagSpecs | null {
  const obj = parseMaterialSpecs(raw);
  const gauge = typeof obj.gauge === "string" ? obj.gauge : null;
  const etdRequired = typeof obj.etdRequired === "string" ? obj.etdRequired : null;
  const marketedSize = readDimensions(obj.marketedSize);
  const actualSize = readDimensions(obj.actualSize);
  // New-shape rows must have both sizes + gauge + etdRequired.
  if (marketedSize && actualSize && gauge && etdRequired) {
    return {
      marketedSize,
      actualSize,
      gauge,
      etdRequired,
      bagSize: typeof obj.bagSize === "string" ? obj.bagSize : null,
    };
  }
  // Legacy fallback: only old bagSize string + gauge + etdRequired present. Fabricate
  // empty dimension triples so the type satisfies, callers can still display the legacy
  // bagSize field separately.
  const bagSize = typeof obj.bagSize === "string" ? obj.bagSize : null;
  if (bagSize && gauge && etdRequired) {
    const empty: Dimensions = { length: "", width: "", height: "" };
    return { marketedSize: empty, actualSize: empty, gauge, etdRequired, bagSize };
  }
  return null;
}

export function readManufacturingSpecs(raw: string | null | undefined): ManufacturingSpecs | null {
  const obj = parseMaterialSpecs(raw);
  const m = obj.manufacturing;
  if (m && typeof m === "object" && !Array.isArray(m)) {
    const mat = (m as any).materialSpecification;
    const sz = (m as any).productSize;
    const ec = (m as any).ecLevel;
    const pt = (m as any).productType;
    if (typeof mat === "string" && typeof sz === "string" && typeof ec === "string" && mat && sz && ec) {
      const productType = (MANUFACTURING_PRODUCT_TYPES as readonly string[]).includes(pt)
        ? (pt as ManufacturingProductType)
        : null;
      return { materialSpecification: mat, productSize: sz, ecLevel: ec, productType };
    }
  }
  return null;
}

// Read product lines from materialSpecs JSON. If a productLines array is present we
// return it as-is; otherwise we fall back to the legacy single `manufacturing` block
// (and the rfq-level quantity/unit, which the caller may pass in) and synthesize a
// single-line list. Returns an empty array when nothing manufacturing-shaped is found.
export function readProductLines(
  raw: string | null | undefined,
  legacy?: { quantity?: string | null; unit?: string | null },
): ProductLine[] {
  const obj = parseMaterialSpecs(raw);
  const arr = (obj as any).productLines;
  if (Array.isArray(arr)) {
    const lines: ProductLine[] = [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const pt = (item as any).productType;
      const mat = (item as any).materialSpecification;
      const sz = (item as any).productSize;
      const ec = (item as any).ecLevel;
      const qty = (item as any).quantity;
      const ldb = (item as any).loadabilityPerContainer;
      if (
        typeof pt === "string" &&
        (MANUFACTURING_PRODUCT_TYPES as readonly string[]).includes(pt) &&
        typeof mat === "string" && mat &&
        typeof sz === "string" && sz &&
        typeof ec === "string" && ec &&
        typeof qty === "string" && qty &&
        typeof ldb === "string" && ldb
      ) {
        const notes = typeof (item as any).notes === "string" ? (item as any).notes : null;
        // Validate any per-line productionSplits — only keep rows where both
        // locationName and allocation are present, drop the array if <2 valid rows.
        const rawSplits = (item as any).productionSplits;
        let cleanedSplits: ProductionSplitRow[] | null = null;
        if (Array.isArray(rawSplits)) {
          const ok: ProductionSplitRow[] = [];
          for (const r of rawSplits) {
            if (!r || typeof r !== "object") continue;
            const ln = typeof (r as any).locationName === "string" ? (r as any).locationName : "";
            const al = typeof (r as any).allocation === "string" ? (r as any).allocation : "";
            const nt = typeof (r as any).note === "string" ? (r as any).note : null;
            if (ln && al) ok.push({ locationName: ln, allocation: al, note: nt });
          }
          if (ok.length >= 2) cleanedSplits = ok;
        }
        lines.push({
          productType: pt as ManufacturingProductType,
          materialSpecification: mat,
          productSize: sz,
          ecLevel: ec,
          quantity: qty,
          loadabilityPerContainer: ldb,
          notes,
          productionSplits: cleanedSplits,
        });
      }
    }
    if (lines.length > 0) return lines;
  }
  // Legacy fall-back: synthesize one line from the old single manufacturing block.
  const m = (obj as any).manufacturing;
  if (m && typeof m === "object" && !Array.isArray(m)) {
    const mat = (m as any).materialSpecification;
    const sz = (m as any).productSize;
    const ec = (m as any).ecLevel;
    const pt = (m as any).productType;
    if (typeof mat === "string" && typeof sz === "string" && typeof ec === "string" && mat && sz && ec) {
      const productType = (MANUFACTURING_PRODUCT_TYPES as readonly string[]).includes(pt)
        ? (pt as ManufacturingProductType)
        : ("growbags" as ManufacturingProductType);
      const quantity = legacy?.quantity?.trim() || "";
      const loadability = legacy?.unit?.trim() || "";
      // Don't fabricate empty values — only return a synthesized line if the legacy
      // top-level fields are populated.
      if (quantity && loadability) {
        return [
          {
            productType,
            materialSpecification: mat,
            productSize: sz,
            ecLevel: ec,
            quantity,
            loadabilityPerContainer: loadability,
            notes: null,
            productionSplits: null,
          },
        ];
      }
    }
  }
  return [];
}

// Read production splits from materialSpecs JSON. Returns [] if no splits or shape
// mismatch. Rows are kept as-is (free-form strings).
export function readProductionSplits(raw: string | null | undefined): ProductionSplitRow[] {
  const obj = parseMaterialSpecs(raw);
  const arr = (obj as any).productionSplits;
  if (!Array.isArray(arr)) return [];
  const rows: ProductionSplitRow[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const locationName = typeof (item as any).locationName === "string" ? (item as any).locationName : "";
    const allocation = typeof (item as any).allocation === "string" ? (item as any).allocation : "";
    const note = typeof (item as any).note === "string" ? (item as any).note : null;
    if (locationName && allocation) rows.push({ locationName, allocation, note });
  }
  return rows;
}
export type RfqInvite = typeof rfqInvites.$inferSelect;
export type InsertInvite = z.infer<typeof insertInviteSchema>;
export type Negotiation = typeof negotiations.$inferSelect;
export type InsertNegotiation = z.infer<typeof insertNegotiationSchema>;

export type RfqDocument = typeof rfqDocuments.$inferSelect;
export type RfqDocumentMeta = Omit<RfqDocument, "contentBase64">;

export type AwardRecommendation = typeof awardRecommendations.$inferSelect;

export type User = typeof users.$inferSelect;
export type UserPublic = Omit<
  User,
  "active" | "commercialGrant" | "canSendRfqs" | "canNegotiate" | "canRecommendAwards"
> & {
  active: boolean;
  commercialGrant: boolean;
  canSendRfqs: boolean;
  canNegotiate: boolean;
  canRecommendAwards: boolean;
};

export type AuditEvent = typeof auditEvents.$inferSelect;
export type AuditEventHydrated = Omit<AuditEvent, "metadata"> & {
  metadata: Record<string, unknown>;
};

export type NotificationRow = typeof notifications.$inferSelect;
export type Notification = Omit<NotificationRow, "readByRoles"> & {
  readByRoles: Record<string, string>;
  isRead: boolean;
};

export const insertAwardRecommendationSchema = z.object({
  inviteId: z.coerce.number().int().positive(),
  rationale: z.string().min(5, "Rationale must explain why this recipient should win"),
  proposedClosureReason: z
    .string()
    .max(1000)
    .optional()
    .nullable()
    .transform((value) => (value === undefined || value === null ? null : value.trim() ? value.trim() : null)),
  recommendedBy: z.string().max(120).optional(),
});
export type InsertAwardRecommendation = z.infer<typeof insertAwardRecommendationSchema>;

export const recommendationDecisionSchema = z.object({
  action: z.enum(["approve", "reject", "return"]),
  decisionNote: z.string().max(2000).optional(),
  // Only used on approve — overrides the closure reason from the recommendation if supplied
  closureReason: z.string().max(2000).optional(),
});
export type RecommendationDecision = z.infer<typeof recommendationDecisionSchema>;

export const insertRfqDocumentSchema = z.object({
  documentType: z.enum(RFQ_DOCUMENT_TYPES),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  size: z.coerce.number().int().nonnegative().max(15 * 1024 * 1024, "File too large (15MB max)"),
  contentBase64: z.string().min(1, "Empty file content"),
  uploadedBy: z.string().min(1).max(120).optional(),
});
export type InsertRfqDocument = z.infer<typeof insertRfqDocumentSchema>;

export type InviteWithDetails = RfqInvite & {
  subcontractor?: Subcontractor | null;
  factory?: Factory | null;
  company?: Company | null;
  recipientName: string;
  recipientContact: string;
  recipientEmail: string;
  negotiations: Negotiation[];
};

export type RfqDetail = {
  rfq: Rfq;
  requestingCompany?: Company | null;
  producingCompany?: Company | null;
  producingFactory?: Factory | null;
  invites: InviteWithDetails[];
};
