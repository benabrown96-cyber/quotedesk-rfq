import {
  auditEvents,
  awardRecommendations,
  companies,
  factories,
  insertRfqSchema,
  updateRfqSchema,
  negotiations,
  notifications,
  rfqDocuments,
  rfqInvites,
  rfqs,
  rfqAmendments,
  subcontractors,
  systemSettings,
  users,
  partnerClients,
  type ResponseDayMode,
  type SystemSettings,
  type SubcontractorRow,
  DEFAULT_PRICE_VALIDITY_MONTHS,
  workflowForCategory,
  ownerTeamForCategory,
  RFQ_CODE_PREFIX,
  MANUFACTURING_PRODUCT_TYPES,
  REQUIRED_MFG_DOC_TYPES,
  parseAmendmentChangedFields,
  type RfqAmendment,
  type RfqAmendmentChangedField,
  type RfqAmendmentSafe,
  type DocumentRequirementStatus,
  type RfqDocumentType,
} from "@shared/schema";
import type {
  AuditEvent,
  AuditEventHydrated,
  AuditEventType,
  AwardRecommendation,
  Company,
  Factory,
  InsertAwardRecommendation,
  InsertInvite,
  InsertNegotiation,
  InsertRfq,
  InsertRfqDocument,
  InsertSubcontractor,
  InviteWithDetails,
  Negotiation,
  Notification,
  NotificationAudience,
  NotificationType,
  Rfq,
  RfqDetail,
  RfqDocument,
  RfqDocumentMeta,
  RfqInvite,
  Subcontractor,
  User,
  UpdateRfq,
  PolybagSpecs,
  ManufacturingSpecs,
  ProductionSplits,
  ProductionSplitRow,
  ProductLine,
  ProductLines,
  PartnerClient,
} from "@shared/schema";
import {
  DEFAULT_CLOSURE_REASON,
  INDIA_BLOCKED_REQUESTING_COMPANY_CODES,
  INDIA_BLOCKED_MESSAGE,
  isSubcontractorAvailableForCluster,
  SUBCONTRACTOR_CLUSTER_BLOCKED_MESSAGE,
  isVendorAllowedForCategory,
  VENDOR_CATEGORY_BLOCKED_MESSAGE,
} from "@shared/roles";
import type { RfqCategory } from "@shared/schema";
import {
  computeTokenState,
  defaultResponseDue,
  defaultDealCloseDue,
  defaultTokenExpiry,
  formatUSD,
} from "@shared/lib";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { and, eq, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";

// Public custom error so routes can return useful 4xx messages.
export class RfqRoutingError extends Error {
  status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.status = status;
  }
}

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

function hasColumn(table: string, column: string) {
  return sqlite.prepare(`PRAGMA table_info(${table})`).all().some((row: any) => row.name === column);
}

function addColumn(table: string, column: string, definition: string) {
  if (!hasColumn(table, column)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    cluster_name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS factories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'Sri Lanka',
    location TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subcontractors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    email TEXT NOT NULL,
    specialty TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'Sri Lanka',
    rating TEXT NOT NULL DEFAULT 'Preferred',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rfqs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    request_type TEXT NOT NULL DEFAULT 'external_rfq',
    requesting_company_id INTEGER NOT NULL DEFAULT 1,
    producing_company_id INTEGER,
    producing_factory_id INTEGER,
    cluster_name TEXT NOT NULL DEFAULT 'Tropicoir / Premier Tech',
    price_visibility TEXT NOT NULL DEFAULT 'visible',
    negotiation_scope TEXT NOT NULL DEFAULT 'price_etd',
    escalation_source_rfq_id INTEGER,
    escalation_reason TEXT,
    project_name TEXT NOT NULL,
    package_name TEXT NOT NULL,
    description TEXT NOT NULL,
    quantity TEXT NOT NULL,
    unit TEXT NOT NULL,
    target_etd TEXT NOT NULL,
    response_due TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rfq_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfq_id INTEGER NOT NULL,
    recipient_type TEXT NOT NULL DEFAULT 'external_subcontractor',
    subcontractor_id INTEGER,
    factory_id INTEGER,
    company_id INTEGER,
    country TEXT NOT NULL DEFAULT 'Sri Lanka',
    price_visibility TEXT NOT NULL DEFAULT 'visible',
    negotiation_scope TEXT NOT NULL DEFAULT 'price_etd',
    token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'sent',
    current_price INTEGER,
    current_etd TEXT,
    last_note TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rfq_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfq_id INTEGER NOT NULL,
    document_type TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    content_base64 TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    uploaded_by_role TEXT NOT NULL,
    uploaded_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS negotiations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invite_id INTEGER NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    price INTEGER,
    etd TEXT,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfq_id INTEGER NOT NULL,
    invite_id INTEGER,
    recommendation_id INTEGER,
    notification_type TEXT NOT NULL,
    audience TEXT NOT NULL,
    audience_company_id INTEGER,
    audience_factory_id INTEGER,
    audience_invite_id INTEGER,
    recipient_label TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    read_by_roles TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    user_type TEXT NOT NULL DEFAULT 'internal',
    auth_provider TEXT NOT NULL DEFAULT 'demo',
    role TEXT NOT NULL,
    scope_type TEXT NOT NULL DEFAULT 'none',
    scope_id INTEGER,
    company_id INTEGER,
    factory_id INTEGER,
    subcontractor_id INTEGER,
    cluster_name TEXT,
    commercial_grant INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS award_recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfq_id INTEGER NOT NULL,
    invite_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    recommended_by_role TEXT NOT NULL,
    recommended_by TEXT,
    rationale TEXT NOT NULL,
    proposed_closure_reason TEXT,
    decision_note TEXT,
    decided_by_role TEXT,
    created_at TEXT NOT NULL,
    decided_at TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    rfq_id INTEGER,
    invite_id INTEGER,
    recommendation_id INTEGER,
    document_id INTEGER,
    actor_user_id INTEGER,
    actor_role TEXT NOT NULL,
    actor_label TEXT NOT NULL,
    action TEXT NOT NULL,
    summary TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS system_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    response_default_days INTEGER NOT NULL DEFAULT 5,
    response_day_mode TEXT NOT NULL DEFAULT 'business',
    updated_at TEXT NOT NULL,
    updated_by TEXT
  );
`);

addColumn("subcontractors", "country", "TEXT NOT NULL DEFAULT 'Sri Lanka'");
addColumn("rfqs", "request_type", "TEXT NOT NULL DEFAULT 'external_rfq'");
addColumn("rfqs", "requesting_company_id", "INTEGER NOT NULL DEFAULT 1");
addColumn("rfqs", "producing_company_id", "INTEGER");
addColumn("rfqs", "producing_factory_id", "INTEGER");
addColumn("rfqs", "cluster_name", "TEXT NOT NULL DEFAULT 'Tropicoir / Premier Tech'");
addColumn("rfqs", "price_visibility", "TEXT NOT NULL DEFAULT 'visible'");
addColumn("rfqs", "negotiation_scope", "TEXT NOT NULL DEFAULT 'price_etd'");
addColumn("rfqs", "escalation_source_rfq_id", "INTEGER");
addColumn("rfqs", "escalation_reason", "TEXT");
addColumn("rfq_invites", "recipient_type", "TEXT NOT NULL DEFAULT 'external_subcontractor'");
addColumn("rfq_invites", "factory_id", "INTEGER");
addColumn("rfq_invites", "company_id", "INTEGER");
addColumn("rfq_invites", "country", "TEXT NOT NULL DEFAULT 'Sri Lanka'");
addColumn("rfq_invites", "price_visibility", "TEXT NOT NULL DEFAULT 'visible'");
addColumn("rfq_invites", "negotiation_scope", "TEXT NOT NULL DEFAULT 'price_etd'");
addColumn("rfq_invites", "closure_reason", "TEXT");
addColumn("rfq_invites", "closed_at", "TEXT");
addColumn("rfqs", "awarded_invite_id", "INTEGER");
addColumn("rfqs", "awarded_at", "TEXT");
addColumn("rfqs", "expires_at", "TEXT");
addColumn("rfq_invites", "token_expires_at", "TEXT");
addColumn("rfq_invites", "token_revoked_at", "TEXT");
addColumn("rfq_invites", "last_accessed_at", "TEXT");
addColumn("rfq_invites", "access_count", "INTEGER NOT NULL DEFAULT 0");
addColumn("users", "can_send_rfqs", "INTEGER NOT NULL DEFAULT 0");
addColumn("users", "can_negotiate", "INTEGER NOT NULL DEFAULT 0");
addColumn("users", "can_recommend_awards", "INTEGER NOT NULL DEFAULT 0");
addColumn("subcontractors", "cluster_access", "TEXT NOT NULL DEFAULT '[]'");
addColumn("subcontractors", "vendor_type", "TEXT NOT NULL DEFAULT 'manufacturing_subcontractor'");
addColumn("subcontractors", "supported_categories", "TEXT NOT NULL DEFAULT '[]'");
addColumn("subcontractors", "materials_supplied", "TEXT");
addColumn("rfqs", "category", "TEXT NOT NULL DEFAULT 'manufacturing_subcontractor'");
addColumn("rfqs", "workflow_type", "TEXT NOT NULL DEFAULT 'standard_rfq'");
addColumn("rfqs", "price_validity_months", "INTEGER");
addColumn("rfqs", "material_specs", "TEXT NOT NULL DEFAULT '{}'");
// Product Manufacturing PO context. Captured on create when category=manufacturing_subcontractor.
addColumn("rfqs", "partner_client", "TEXT");
addColumn("rfqs", "po_country", "TEXT");
addColumn("rfqs", "po_customer_name", "TEXT");
// Deal close target (overall RFQ close-by deadline). Distinct from response_due
// (the 24-hour initial response window). Backfilled below for legacy rows.
addColumn("rfqs", "deal_close_due", "TEXT");
// Settings columns for the deal-close window. Default 7 calendar days.
addColumn("system_settings", "deal_close_default_days", "INTEGER NOT NULL DEFAULT 7");
addColumn("system_settings", "deal_close_day_mode", "TEXT NOT NULL DEFAULT 'calendar'");

// Partner / client master data, filtered per cluster on the picker.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS partner_clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    country TEXT NOT NULL,
    cluster_name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
`);

// RFQ amendment / version history. Rev 0 is the baseline created at RFQ creation;
// Rev 1+ are written each time updateRfq() persists a change. The internal record
// preserves field-by-field snapshots for senior management / commercial roles. The
// portal-safe view (listAmendmentsSafe) exposes only revisionNumber, safeSummary,
// and createdAt so external recipients never see admin-only data.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS rfq_amendments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rfq_id INTEGER NOT NULL,
    revision_number INTEGER NOT NULL,
    changed_by TEXT NOT NULL,
    changed_by_role TEXT NOT NULL,
    reason TEXT,
    safe_summary TEXT NOT NULL,
    internal_summary TEXT NOT NULL,
    changed_fields TEXT NOT NULL DEFAULT '[]',
    notified_recipients INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_rfq_amendments_rfq_id ON rfq_amendments(rfq_id);
`);

// Backfill workflow_type and priceValidity for existing rows so dashboards / portals
// can render the right copy without each call site hard-coding category → workflow.
sqlite.exec(`UPDATE rfqs SET workflow_type = 'price_validity_inquiry', price_validity_months = COALESCE(price_validity_months, 6) WHERE workflow_type = 'standard_rfq' AND category IN ('wooden_pallets','cardboard');`);
sqlite.exec(`UPDATE rfqs SET workflow_type = 'polybag_rfq' WHERE workflow_type = 'standard_rfq' AND category = 'polythene_bags';`);
sqlite.exec(`UPDATE rfqs SET material_specs = '{}' WHERE material_specs IS NULL OR material_specs = '';`);

// Backfill granular permissions for users who already had commercialGrant=true.
sqlite.exec(`
  UPDATE users
     SET can_send_rfqs = 1,
         can_negotiate = 1,
         can_recommend_awards = 1
   WHERE commercial_grant = 1
     AND can_send_rfqs = 0
     AND can_negotiate = 0
     AND can_recommend_awards = 0;
`);

// Backfill expires_at on existing RFQs to the responseDue value, so the dashboard
// has something sensible to count down to without requiring a manual touch.
sqlite.exec(`UPDATE rfqs SET expires_at = response_due || 'T17:00:00.000Z' WHERE expires_at IS NULL;`);

// Backfill deal_close_due on legacy rows to createdAt + 7 days (calendar). We compute
// inline in SQLite — SQLite's date() handles ISO timestamps. We only touch rows that
// have NO close-by date AND are still active (not awarded / accepted / closed) so we
// don't rewrite finished work. Status comparisons match the lib.ts terminal-state set.
sqlite.exec(`
  UPDATE rfqs
     SET deal_close_due = substr(date(created_at, '+7 days'), 1, 10) || 'T17:00:00.000Z'
   WHERE deal_close_due IS NULL
     AND status NOT IN ('awarded', 'accepted', 'closed');
`);
sqlite.exec(`UPDATE rfq_invites SET access_count = COALESCE(access_count, 0);`);

// Backfill cluster_access on subcontractors created before the column existed.
sqlite.exec(`UPDATE subcontractors SET cluster_access = '[]' WHERE cluster_access IS NULL OR cluster_access = '';`);
// Back-compat: any existing subcontractor row with no vendorType is a manufacturing
// subcontractor (that was the only kind before this migration).
sqlite.exec(
  `UPDATE subcontractors SET vendor_type = 'manufacturing_subcontractor' WHERE vendor_type IS NULL OR vendor_type = '';`,
);
sqlite.exec(
  `UPDATE subcontractors SET supported_categories = '[]' WHERE supported_categories IS NULL OR supported_categories = '';`,
);
// All existing RFQs predate categories — mark them as manufacturing_subcontractor.
sqlite.exec(`UPDATE rfqs SET category = 'manufacturing_subcontractor' WHERE category IS NULL OR category = '';`);

// Operating-rule data hygiene:
// - Internal factories must be Sri Lanka only (no India / Indonesia internal factories).
//   Existing rows are normalised here; deletions of any non-SriLanka factories are safe
//   because the seeded fixtures only ever inserted Sri Lankan factories.
sqlite.exec(`UPDATE factories SET country = 'Sri Lanka' WHERE country IS NULL OR country = ''`);
sqlite.exec(`DELETE FROM factories WHERE country <> 'Sri Lanka'`);

export const db = drizzle(sqlite);

export interface IStorage {
  listCompanies(): Promise<Company[]>;
  listFactories(): Promise<Factory[]>;
  listSubcontractors(): Promise<Subcontractor[]>;
  createSubcontractor(subcontractor: InsertSubcontractor): Promise<Subcontractor>;
  listPartnerClients(filter?: { clusterName?: string | null }): Promise<PartnerClient[]>;
  listRfqs(): Promise<Rfq[]>;
  getRfqDetail(id: number): Promise<RfqDetail | undefined>;
  createRfq(rfq: InsertRfq): Promise<Rfq>;
  updateRfq(rfqId: number, patch: UpdateRfq, actor: { userId?: number | null; role: string; label: string }): Promise<{ rfq: Rfq; changedFields: string[] } | undefined>;
  inviteRecipient(rfqId: number, input: InsertInvite): Promise<RfqInvite>;
  escalateToExternal(rfqId: number, subcontractorId: number, reason: string): Promise<RfqInvite>;
  awardInvite(rfqId: number, inviteId: number, manualReason?: string): Promise<RfqDetail | undefined>;
  setInviteClosure(inviteId: number, reason: string): Promise<RfqInvite | undefined>;
  getInviteByToken(token: string): Promise<RfqDetail | undefined>;
  getInviteById(id: number): Promise<RfqInvite | undefined>;
  rfqIdsForFactory(factoryId: number): Promise<number[]>;
  rfqIdsForSubcontractor(subcontractorId: number): Promise<number[]>;
  addNegotiation(input: InsertNegotiation): Promise<Negotiation>;
  listRfqDocuments(rfqId: number): Promise<RfqDocumentMeta[]>;
  // Document requirement check for invite-send / award flows. Returns a status
  // object exposing only present/missing booleans — NEVER filenames or metadata.
  // Safe to call from any route (no leakage to vendors / factories).
  getDocumentRequirementStatus(rfqId: number): Promise<DocumentRequirementStatus>;
  // RFQ amendments / version history.
  recordRfqAmendment(input: {
    rfqId: number;
    changedBy: string;
    changedByRole: string;
    reason?: string | null;
    safeSummary: string;
    internalSummary: string;
    changedFields: RfqAmendmentChangedField[];
    notifiedRecipients?: number;
    isBaseline?: boolean;
  }): Promise<RfqAmendment>;
  listAmendments(rfqId: number): Promise<RfqAmendment[]>;
  listAmendmentsSafe(rfqId: number): Promise<RfqAmendmentSafe[]>;
  listAwardRecommendations(rfqId: number): Promise<AwardRecommendation[]>;
  getAwardRecommendation(id: number): Promise<AwardRecommendation | undefined>;
  createAwardRecommendation(
    rfqId: number,
    role: string,
    input: InsertAwardRecommendation,
  ): Promise<AwardRecommendation>;
  decideAwardRecommendation(
    id: number,
    decision: "approved" | "rejected" | "returned",
    decidedByRole: string,
    decisionNote?: string,
    closureReasonOverride?: string,
  ): Promise<{ recommendation: AwardRecommendation; rfqDetail?: RfqDetail }>;
  getRfqDocument(rfqId: number, documentId: number): Promise<RfqDocument | undefined>;
  saveRfqDocument(rfqId: number, role: string, input: InsertRfqDocument): Promise<RfqDocumentMeta>;
  deleteRfqDocument(rfqId: number, documentId: number): Promise<boolean>;
  listNotificationsForRole(args: {
    role: string;
    scopeId: number | null;
    rfqId?: number;
  }): Promise<Notification[]>;
  listNotificationsForInvite(inviteId: number): Promise<Notification[]>;
  markNotificationRead(id: number, role: string): Promise<Notification | undefined>;
  markAllNotificationsRead(args: { role: string; scopeId: number | null }): Promise<number>;
  overview(): Promise<{
    totalRfqs: number;
    activeNegotiations: number;
    acceptedOrders: number;
    pendingResponses: number;
    etdOnlyRequests: number;
    externalEscalations: number;
  }>;
  listUsers(): Promise<User[]>;
  getUserById(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  setUserActive(id: number, active: boolean): Promise<User | undefined>;
  setUserCommercialGrant(id: number, granted: boolean): Promise<User | undefined>;
  setUserPermission(
    id: number,
    field: "canSendRfqs" | "canNegotiate" | "canRecommendAwards",
    value: boolean,
  ): Promise<User | undefined>;
  setUserRole(id: number, role: string): Promise<User | undefined>;
  touchUserLogin(id: number): Promise<User | undefined>;
  // System settings (response window default + day mode + deal-close defaults).
  getSettings(): Promise<SystemSettings>;
  updateSettings(
    patch: Partial<{
      responseDefaultDays: number;
      responseDayMode: ResponseDayMode;
      dealCloseDefaultDays: number;
      dealCloseDayMode: ResponseDayMode;
    }>,
    updatedBy: string,
  ): Promise<SystemSettings>;
  // Subcontractor cluster availability.
  setSubcontractorClusterAccess(id: number, clusters: string[]): Promise<Subcontractor | undefined>;
  // Audit trail.
  logAudit(input: {
    eventType: AuditEventType;
    rfqId?: number | null;
    inviteId?: number | null;
    recommendationId?: number | null;
    documentId?: number | null;
    actor: { userId?: number | null; role: string; label: string };
    action: string;
    summary: string;
    metadata?: Record<string, unknown>;
  }): Promise<AuditEvent>;
  listAuditEvents(filter?: {
    rfqId?: number;
    limit?: number;
  }): Promise<AuditEventHydrated[]>;
  // Token security.
  revokeInviteToken(
    inviteId: number,
    actor: { userId?: number | null; role: string; label: string },
  ): Promise<RfqInvite | undefined>;
  extendInviteToken(
    inviteId: number,
    actor: { userId?: number | null; role: string; label: string },
    extraBusinessDays?: number,
  ): Promise<RfqInvite | undefined>;
}

function now() {
  return new Date().toISOString();
}

function compactToken() {
  return randomUUID().replace(/-/g, "").slice(0, 14);
}

function safeJson(raw: string | null | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function parseReadByRoles(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function hydrateNotification(row: typeof notifications.$inferSelect, role?: string): Notification {
  const readByRoles = parseReadByRoles(row.readByRoles);
  return {
    ...row,
    readByRoles,
    isRead: role ? Boolean(readByRoles[role]) : false,
  };
}

function inviteRecipientLabel(invite: RfqInvite, subcontractor?: Subcontractor | null, factory?: Factory | null, company?: Company | null) {
  if (invite.recipientType === "external_subcontractor") return subcontractor?.name ?? "External subcontractor";
  if (invite.recipientType === "internal_factory") return factory?.name ?? "Internal factory";
  return company?.name ?? "Internal company";
}

function statusForNegotiation(action: InsertNegotiation["action"], actor: InsertNegotiation["actor"], existing: RfqInvite) {
  if (action === "accept") return "accepted";
  if (action === "decline") return "declined";
  if (action === "escalate") return "external_escalated";
  if (action === "message") return existing.status === "sent" ? "under_negotiation" : existing.status;
  if ((action === "quote" || action === "counter") && actor !== "buyer") return "quoted";
  return "under_negotiation";
}

function clusterForCompany(company?: Company | null) {
  return company?.clusterName ?? "Tropicoir / Premier Tech";
}

// Parse JSON-encoded clusterAccess. Empty array on invalid input.
function parseClusterAccess(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
    return [];
  } catch {
    return [];
  }
}

function parseStringList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
    return [];
  } catch {
    return [];
  }
}

function hydrateSubcontractor(row: SubcontractorRow): Subcontractor {
  const vendorType = ((row as any).vendorType as string) === "supplier"
    ? "supplier"
    : "manufacturing_subcontractor";
  return {
    ...row,
    clusterAccess: parseClusterAccess(row.clusterAccess as unknown as string),
    vendorType,
    supportedCategories: parseStringList(
      (row as any).supportedCategories as unknown as string,
    ) as Subcontractor["supportedCategories"],
    materialsSupplied: (row as any).materialsSupplied ?? null,
  };
}

function defaultsForRequestType(requestType: string) {
  if (requestType === "external_rfq") return { priceVisibility: "visible", negotiationScope: "price_etd" };
  return { priceVisibility: "hidden", negotiationScope: "etd_only" };
}

export class DatabaseStorage implements IStorage {
  constructor() {
    this.seed();
  }

  private seed() {
    const createdAt = now();
    if (!db.select().from(companies).get()) {
      [
        { name: "Tropicoir Lanka (PVT) Ltd", clusterName: "Tropicoir / Premier Tech", code: "TCL", createdAt },
        { name: "Premier Tech Lanka", clusterName: "Tropicoir / Premier Tech", code: "PTL", createdAt },
        { name: "Euro Substrates", clusterName: "Euro / Growrite", code: "ESL", createdAt },
        { name: "Growrite Substrate", clusterName: "Euro / Growrite", code: "GRT", createdAt },
      ].forEach((company) => db.insert(companies).values(company).run());
    }

    if (!db.select().from(factories).get()) {
      const allCompanies = db.select().from(companies).all();
      const byCode = (code: string) => allCompanies.find((company) => company.code === code)?.id ?? 1;
      [
        { companyId: byCode("TCL"), name: "Tropicoir Wariyapola Factory", country: "Sri Lanka", location: "Wariyapola", createdAt },
        { companyId: byCode("PTL"), name: "Premier Tech Palai Factory", country: "Sri Lanka", location: "Palai", createdAt },
        { companyId: byCode("ESL"), name: "Euro Substrates Tambuttegama Factory", country: "Sri Lanka", location: "Tambuttegama", createdAt },
        { companyId: byCode("GRT"), name: "Growrite Nikadalupotha Factory", country: "Sri Lanka", location: "Nikadalupotha", createdAt },
      ].forEach((factory) => db.insert(factories).values(factory).run());
    }

    if (!db.select().from(subcontractors).get()) {
      [
        {
          // Shared subcontractor — demonstrates cluster-spanning availability.
          name: "Atlas Coir Logistics",
          contactName: "Maria Jensen",
          email: "quotes@atlas-coir.example",
          specialty: "Sri Lanka packing, loading, and site logistics (both clusters)",
          country: "Sri Lanka",
          rating: "Preferred",
          clusterAccess: JSON.stringify([]), // [] = both clusters
          createdAt,
        },
        {
          name: "CocoLine India",
          contactName: "Arjun Menon",
          email: "rfq@cocoline-india.example",
          specialty: "India coir processing and conversion support",
          country: "India",
          rating: "Approved",
          // India routing rules apply on top of cluster access; only Euro Substrates may invite.
          clusterAccess: JSON.stringify(["Euro / Growrite"]),
          createdAt,
        },
        {
          name: "Nusa Substrate Partners",
          contactName: "Dewi Santoso",
          email: "tenders@nusa-substrate.example",
          specialty: "Indonesia coco substrate packing and export support",
          country: "Indonesia",
          rating: "Preferred",
          clusterAccess: JSON.stringify(["Tropicoir / Premier Tech"]),
          createdAt,
        },
        {
          // Reclassified as a Wooden Pallets supplier under the new vendor model.
          name: "Lanka Pallet Works",
          contactName: "Chamath Silva",
          email: "sales@lanka-pallet.example",
          specialty: "Heat-treated wooden pallet supply and crating",
          country: "Sri Lanka",
          rating: "Preferred",
          clusterAccess: JSON.stringify([
            "Tropicoir / Premier Tech",
            "Euro / Growrite",
          ]),
          vendorType: "supplier",
          supportedCategories: JSON.stringify(["wooden_pallets"]),
          materialsSupplied: "ISPM-15 wooden pallets, crates, dunnage",
          createdAt,
        },
        {
          name: "PolyPack Sri Lanka",
          contactName: "Niluka Rajapaksha",
          email: "orders@polypack-lk.example",
          specialty: "Polythene bags, liners, and shrink film for export packing",
          country: "Sri Lanka",
          rating: "Preferred",
          clusterAccess: JSON.stringify([]),
          vendorType: "supplier",
          supportedCategories: JSON.stringify(["polythene_bags", "packaging_materials"]),
          materialsSupplied: "PE bags, poly liners, shrink film, stretch wrap",
          createdAt,
        },
        {
          name: "CartonPro Lanka",
          contactName: "Tharindu Gunawardena",
          email: "sales@cartonpro.example",
          specialty: "Corrugated cardboard cartons, sleeves, and dividers",
          country: "Sri Lanka",
          rating: "Approved",
          clusterAccess: JSON.stringify([]),
          vendorType: "supplier",
          supportedCategories: JSON.stringify(["cardboard", "packaging_materials"]),
          materialsSupplied: "3-ply / 5-ply cartons, sleeves, dividers, custom print",
          createdAt,
        },
        {
          name: "OceanBridge Logistics",
          contactName: "Ravindu Mendis",
          email: "bookings@oceanbridge.example",
          specialty: "Container haulage, port handling, and freight forwarding",
          country: "Sri Lanka",
          rating: "Preferred",
          clusterAccess: JSON.stringify([]),
          vendorType: "supplier",
          supportedCategories: JSON.stringify(["logistics_shipping"]),
          materialsSupplied: "Inland haulage, port handling, ocean freight forwarding",
          createdAt,
        },
      ].forEach((subcontractor) => db.insert(subcontractors).values(subcontractor as any).run());
    } else {
      // Backfill: rows created before clusterAccess existed get [] (both clusters).
      sqlite.exec(
        `UPDATE subcontractors SET cluster_access = '[]' WHERE cluster_access IS NULL OR cluster_access = '';`,
      );
    }

    // Partner / client master data — seed a couple of plausible partners per cluster
    // so the create-RFQ picker always has options. Users can still type a free-form
    // partner name in the form when a client is not in the master list yet.
    if (!db.select().from(partnerClients).get()) {
      const seedPartners = [
        { name: "Klasmann-Deilmann GmbH", country: "Germany", clusterName: "Tropicoir / Premier Tech" },
        { name: "Premier Tech Horticulture (Canada)", country: "Canada", clusterName: "Tropicoir / Premier Tech" },
        { name: "Sun Gro Horticulture", country: "United States", clusterName: "Tropicoir / Premier Tech" },
        { name: "Jiffy Group", country: "Netherlands", clusterName: "Tropicoir / Premier Tech" },
        { name: "Euro Substrates BV", country: "Netherlands", clusterName: "Euro / Growrite" },
        { name: "Growrite UK Ltd", country: "United Kingdom", clusterName: "Euro / Growrite" },
        { name: "Bord na M\u00f3na (Ireland)", country: "Ireland", clusterName: "Euro / Growrite" },
        { name: "Vivai Berto Italia", country: "Italy", clusterName: "Euro / Growrite" },
      ];
      for (const p of seedPartners) {
        db.insert(partnerClients)
          .values({ name: p.name, country: p.country, clusterName: p.clusterName, active: true, createdAt })
          .run();
      }
    }

    if (!db.select().from(rfqs).get()) {
      const tropicoir = db.select().from(companies).where(eq(companies.code, "TCL")).get();
      const premier = db.select().from(companies).where(eq(companies.code, "PTL")).get();
      const palai = db.select().from(factories).where(eq(factories.name, "Premier Tech Palai Factory")).get();
      const rfq = db
        .insert(rfqs)
        .values({
          reference: "RFQ-2026-001",
          requestType: "intercompany",
          requestingCompanyId: tropicoir?.id ?? 1,
          producingCompanyId: premier?.id ?? null,
          producingFactoryId: palai?.id ?? null,
          clusterName: "Tropicoir / Premier Tech",
          priceVisibility: "hidden",
          negotiationScope: "etd_only",
          escalationSourceRfqId: null,
          escalationReason: null,
          projectName: "TEG Substrate Supply",
          packageName: "Internal grow bag production slot",
          description: "Confirm production capacity and earliest dispatch date for a priority grow bag order. Price is hidden from factory users.",
          quantity: "2",
          unit: "Containers",
          targetEtd: "2026-06-14",
          responseDue: "2026-05-10",
          expiresAt: "2026-05-10T17:00:00.000Z",
          // Seed deal-close target 7 calendar days from createdAt to keep the demo
          // sample consistent with the new close-by rule.
          dealCloseDue: defaultDealCloseDue(createdAt, 7, "calendar"),
          status: "under_negotiation",
          createdAt,
        })
        .returning()
        .get();

      if (palai) {
        const invite = db
          .insert(rfqInvites)
          .values({
            rfqId: rfq.id,
            recipientType: "internal_factory",
            subcontractorId: 0,
            factoryId: palai.id,
            companyId: premier?.id ?? null,
            country: palai.country,
            priceVisibility: "hidden",
            negotiationScope: "etd_only",
            token: compactToken(),
            status: "under_negotiation",
            currentPrice: null,
            currentEtd: "2026-06-21",
            lastNote: "Factory can produce, but ETD is later than requested due to capacity.",
            updatedAt: createdAt,
          })
          .returning()
          .get();

        db.insert(negotiations)
          .values({
            inviteId: invite.id,
            actor: "factory",
            action: "quote",
            price: null,
            etd: "2026-06-21",
            note: "Capacity available, earliest ETD is 21 June.",
            createdAt,
          })
          .run();
      }
    }

    if (!db.select().from(users).get()) {
      const allCompanies = db.select().from(companies).all();
      const allFactories = db.select().from(factories).all();
      const allSubcontractors = db.select().from(subcontractors).all();
      const byCompanyCode = (code: string) => allCompanies.find((c) => c.code === code);
      const tcl = byCompanyCode("TCL");
      const esl = byCompanyCode("ESL");
      const palai = allFactories.find((f) => f.name.includes("Palai"));
      const atlas = allSubcontractors.find((s) => s.name.includes("Atlas"));

      const seedUsers = [
        {
          // Senior Management — final business approval authority. Replaces the old TEG admin label.
          name: "Priya Wickramasinghe",
          email: "priya.wickramasinghe@theexpertsgroup.onmicrosoft.com",
          userType: "internal",
          authProvider: "microsoft",
          role: "senior_management",
          scopeType: "none",
          scopeId: null,
          companyId: null,
          factoryId: null,
          subcontractorId: null,
          clusterName: null,
          commercialGrant: true,
          active: true,
          lastLoginAt: null,
          createdAt,
        },
        {
          // Platform Admin / IT Support — manages users, settings, tokens. NO commercial decisions.
          name: "Indira Ratnayake (IT)",
          email: "indira.ratnayake@theexpertsgroup.onmicrosoft.com",
          userType: "internal",
          authProvider: "microsoft",
          role: "platform_admin",
          scopeType: "none",
          scopeId: null,
          companyId: null,
          factoryId: null,
          subcontractorId: null,
          clusterName: null,
          commercialGrant: false,
          active: true,
          lastLoginAt: null,
          createdAt,
        },
        {
          // Commercial Manager — cluster oversight, optional role. Cannot finalise awards.
          name: "Suresh Kumar",
          email: "suresh.kumar@tropicoir.theexpertsgroup.onmicrosoft.com",
          userType: "internal",
          authProvider: "microsoft",
          role: "commercial_manager",
          scopeType: "company",
          scopeId: tcl?.id ?? null,
          companyId: tcl?.id ?? null,
          factoryId: null,
          subcontractorId: null,
          clusterName: "Tropicoir / Premier Tech",
          commercialGrant: true,
          active: true,
          lastLoginAt: null,
          createdAt,
        },
        {
          name: "Asanka Perera",
          email: "asanka.perera@tropicoir.theexpertsgroup.onmicrosoft.com",
          userType: "internal",
          authProvider: "microsoft",
          role: "commercial_staff",
          scopeType: "company",
          scopeId: tcl?.id ?? null,
          companyId: tcl?.id ?? null,
          factoryId: null,
          subcontractorId: null,
          clusterName: "Tropicoir / Premier Tech",
          commercialGrant: true,
          active: true,
          lastLoginAt: null,
          createdAt,
        },
        {
          name: "Nuwan Jayasinghe",
          email: "nuwan.jayasinghe@euro.theexpertsgroup.onmicrosoft.com",
          userType: "internal",
          authProvider: "microsoft",
          role: "commercial_staff",
          scopeType: "company",
          scopeId: esl?.id ?? null,
          companyId: esl?.id ?? null,
          factoryId: null,
          subcontractorId: null,
          clusterName: "Euro / Growrite",
          commercialGrant: false,
          active: true,
          lastLoginAt: null,
          createdAt,
        },
        // Note: previously seeded as role="buyer". Buyer has been retired — this user
        // is now Commercial Staff with full granular grants (send / negotiate /
        // recommend), since the original buyer’s day-to-day work falls under that role.
        // Award authority moves to Senior Management.
        {
          name: "Dilani Fernando",
          email: "dilani.fernando@tropicoir.theexpertsgroup.onmicrosoft.com",
          userType: "internal",
          authProvider: "microsoft",
          role: "commercial_staff",
          scopeType: "company",
          scopeId: tcl?.id ?? null,
          companyId: tcl?.id ?? null,
          factoryId: null,
          subcontractorId: null,
          clusterName: "Tropicoir / Premier Tech",
          commercialGrant: true,
          active: true,
          lastLoginAt: null,
          createdAt,
        },
        {
          name: "Ruwan Bandara",
          email: "ruwan.bandara@premiertech.theexpertsgroup.onmicrosoft.com",
          userType: "internal",
          authProvider: "microsoft",
          role: "factory_user",
          scopeType: "factory",
          scopeId: palai?.id ?? null,
          companyId: null,
          factoryId: palai?.id ?? null,
          subcontractorId: null,
          clusterName: null,
          commercialGrant: false,
          active: true,
          lastLoginAt: null,
          createdAt,
        },
        {
          name: "Maria Jensen",
          email: "maria.jensen@atlas-coir.example",
          userType: "external",
          authProvider: "google",
          role: "subcontractor_user",
          scopeType: "subcontractor",
          scopeId: atlas?.id ?? null,
          companyId: null,
          factoryId: null,
          subcontractorId: atlas?.id ?? null,
          clusterName: null,
          commercialGrant: false,
          active: true,
          lastLoginAt: null,
          createdAt,
        },
        {
          name: "Inactive Demo User",
          email: "inactive.demo@theexpertsgroup.onmicrosoft.com",
          userType: "internal",
          authProvider: "microsoft",
          role: "commercial_staff",
          scopeType: "company",
          scopeId: tcl?.id ?? null,
          companyId: tcl?.id ?? null,
          factoryId: null,
          subcontractorId: null,
          clusterName: "Tropicoir / Premier Tech",
          commercialGrant: false,
          active: false,
          lastLoginAt: null,
          createdAt,
        },
      ] as const;
      seedUsers.forEach((u) => {
        // Mirror commercialGrant onto the granular flags so seeded commercial staff have
        // the same effective permissions they had before this migration.
        const granular = u.commercialGrant
          ? { canSendRfqs: true, canNegotiate: true, canRecommendAwards: true }
          : { canSendRfqs: false, canNegotiate: false, canRecommendAwards: false };
        db.insert(users).values({ ...(u as any), ...granular }).run();
      });
    }

    // Idempotent migration: ensure the new role users exist on existing DBs that were
    // seeded before the role split. Insert by email if missing.
    const allCompanies = db.select().from(companies).all();
    const tcl = allCompanies.find((c) => c.code === "TCL");
    const ensureUser = (u: any) => {
      const exists = db.select().from(users).where(eq(users.email, u.email)).get();
      if (exists) return;
      const granular = u.commercialGrant
        ? { canSendRfqs: true, canNegotiate: true, canRecommendAwards: true }
        : { canSendRfqs: false, canNegotiate: false, canRecommendAwards: false };
      db.insert(users).values({ ...u, ...granular }).run();
    };
    const ts = now();
    ensureUser({
      name: "Indira Ratnayake (IT)",
      email: "indira.ratnayake@theexpertsgroup.onmicrosoft.com",
      userType: "internal",
      authProvider: "microsoft",
      role: "platform_admin",
      scopeType: "none",
      scopeId: null,
      companyId: null,
      factoryId: null,
      subcontractorId: null,
      clusterName: null,
      commercialGrant: false,
      active: true,
      lastLoginAt: null,
      createdAt: ts,
    });
    ensureUser({
      name: "Sanjeewa Wijesinghe (Senior Mgmt)",
      email: "sanjeewa.wijesinghe@theexpertsgroup.onmicrosoft.com",
      userType: "internal",
      authProvider: "microsoft",
      role: "senior_management",
      scopeType: "none",
      scopeId: null,
      companyId: null,
      factoryId: null,
      subcontractorId: null,
      clusterName: null,
      commercialGrant: true,
      active: true,
      lastLoginAt: null,
      createdAt: ts,
    });
    ensureUser({
      name: "Suresh Kumar",
      email: "suresh.kumar@tropicoir.theexpertsgroup.onmicrosoft.com",
      userType: "internal",
      authProvider: "microsoft",
      role: "commercial_manager",
      scopeType: "company",
      scopeId: tcl?.id ?? null,
      companyId: tcl?.id ?? null,
      factoryId: null,
      subcontractorId: null,
      clusterName: "Tropicoir / Premier Tech",
      commercialGrant: true,
      active: true,
      lastLoginAt: null,
      createdAt: ts,
    });
    // Idempotent migration: any user row left with the retired role="buyer" is
    // converted to role="commercial_staff" with full granular grants. Award
    // authority moves to Senior Management; the day-to-day RFQ + negotiate work
    // is what Commercial Staff already covers.
    const legacyBuyers = db.select().from(users).where(eq(users.role, "buyer")).all();
    for (const lb of legacyBuyers) {
      db.update(users)
        .set({
          role: "commercial_staff",
          commercialGrant: true,
          canSendRfqs: true,
          canNegotiate: true,
          canRecommendAwards: true,
        })
        .where(eq(users.id, lb.id))
        .run();
    }

    // Idempotent migration: existing demo databases predate supplier vendors. Make sure the
    // four named supplier records exist; reclassify Lanka Pallet Works to the new vendor
    // model and seed the rest if missing. We match by name to avoid duplicates.
    const ensureSupplier = (s: {
      name: string;
      contactName: string;
      email: string;
      specialty: string;
      country: string;
      rating: string;
      clusterAccess: string[];
      supportedCategories: string[];
      materialsSupplied: string;
    }) => {
      const existing = db
        .select()
        .from(subcontractors)
        .where(eq(subcontractors.name, s.name))
        .get();
      if (existing) {
        // Reclassify legacy Lanka Pallet Works (or any matching name with stale fields)
        // into the supplier model with the right category list.
        db.update(subcontractors)
          .set({
            vendorType: "supplier",
            supportedCategories: JSON.stringify(s.supportedCategories),
            materialsSupplied: s.materialsSupplied,
          } as any)
          .where(eq(subcontractors.id, existing.id))
          .run();
        return;
      }
      db.insert(subcontractors)
        .values({
          name: s.name,
          contactName: s.contactName,
          email: s.email,
          specialty: s.specialty,
          country: s.country,
          rating: s.rating,
          clusterAccess: JSON.stringify(s.clusterAccess),
          vendorType: "supplier",
          supportedCategories: JSON.stringify(s.supportedCategories),
          materialsSupplied: s.materialsSupplied,
          createdAt: ts,
        } as any)
        .run();
    };
    ensureSupplier({
      name: "Lanka Pallet Works",
      contactName: "Chamath Silva",
      email: "sales@lanka-pallet.example",
      specialty: "Heat-treated wooden pallet supply and crating",
      country: "Sri Lanka",
      rating: "Preferred",
      clusterAccess: ["Tropicoir / Premier Tech", "Euro / Growrite"],
      supportedCategories: ["wooden_pallets"],
      materialsSupplied: "ISPM-15 wooden pallets, crates, dunnage",
    });
    ensureSupplier({
      name: "PolyPack Sri Lanka",
      contactName: "Niluka Rajapaksha",
      email: "orders@polypack-lk.example",
      specialty: "Polythene bags, liners, and shrink film for export packing",
      country: "Sri Lanka",
      rating: "Preferred",
      clusterAccess: [],
      supportedCategories: ["polythene_bags", "packaging_materials"],
      materialsSupplied: "PE bags, poly liners, shrink film, stretch wrap",
    });
    ensureSupplier({
      name: "CartonPro Lanka",
      contactName: "Tharindu Gunawardena",
      email: "sales@cartonpro.example",
      specialty: "Corrugated cardboard cartons, sleeves, and dividers",
      country: "Sri Lanka",
      rating: "Approved",
      clusterAccess: [],
      supportedCategories: ["cardboard", "packaging_materials"],
      materialsSupplied: "3-ply / 5-ply cartons, sleeves, dividers, custom print",
    });
    ensureSupplier({
      name: "OceanBridge Logistics",
      contactName: "Ravindu Mendis",
      email: "bookings@oceanbridge.example",
      specialty: "Container haulage, port handling, and freight forwarding",
      country: "Sri Lanka",
      rating: "Preferred",
      clusterAccess: [],
      supportedCategories: ["logistics_shipping"],
      materialsSupplied: "Inland haulage, port handling, ocean freight forwarding",
    });

    // Ensure system_settings row exists. Default response window: 1 calendar day (~24h);
    // deal close: 7 calendar days from RFQ creation.
    if (!db.select().from(systemSettings).get()) {
      db.insert(systemSettings)
        .values({
          responseDefaultDays: 1,
          responseDayMode: "calendar",
          dealCloseDefaultDays: 7,
          dealCloseDayMode: "calendar",
          updatedAt: ts,
          updatedBy: null,
        })
        .run();
    }
  }

  async listUsers(): Promise<User[]> {
    return db.select().from(users).all();
  }

  async getUserById(id: number): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.id, id)).get();
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.email, email)).get();
  }

  async setUserActive(id: number, active: boolean): Promise<User | undefined> {
    db.update(users).set({ active }).where(eq(users.id, id)).run();
    return this.getUserById(id);
  }

  async setUserCommercialGrant(id: number, granted: boolean): Promise<User | undefined> {
    // Toggling the legacy umbrella flag synchronizes all three granular flags so the user's
    // effective permissions stay coherent. (Backfill at boot also handles this for existing rows.)
    db.update(users)
      .set({
        commercialGrant: granted,
        canSendRfqs: granted,
        canNegotiate: granted,
        canRecommendAwards: granted,
      })
      .where(eq(users.id, id))
      .run();
    return this.getUserById(id);
  }

  async setUserPermission(
    id: number,
    field: "canSendRfqs" | "canNegotiate" | "canRecommendAwards",
    value: boolean,
  ): Promise<User | undefined> {
    db.update(users).set({ [field]: value } as any).where(eq(users.id, id)).run();
    // Keep the legacy umbrella flag mirroring "any granular = umbrella on".
    const updated = this.getUserById(id);
    const u = await updated;
    if (u) {
      const anyOn = Boolean(u.canSendRfqs || u.canNegotiate || u.canRecommendAwards);
      if (Boolean(u.commercialGrant) !== anyOn) {
        db.update(users).set({ commercialGrant: anyOn }).where(eq(users.id, id)).run();
      }
    }
    return this.getUserById(id);
  }

  async logAudit(input: {
    eventType: AuditEventType;
    rfqId?: number | null;
    inviteId?: number | null;
    recommendationId?: number | null;
    documentId?: number | null;
    actor: { userId?: number | null; role: string; label: string };
    action: string;
    summary: string;
    metadata?: Record<string, unknown>;
  }): Promise<AuditEvent> {
    const row = db
      .insert(auditEvents)
      .values({
        eventType: input.eventType,
        rfqId: input.rfqId ?? null,
        inviteId: input.inviteId ?? null,
        recommendationId: input.recommendationId ?? null,
        documentId: input.documentId ?? null,
        actorUserId: input.actor.userId ?? null,
        actorRole: input.actor.role,
        actorLabel: input.actor.label,
        action: input.action,
        summary: input.summary,
        metadata: JSON.stringify(input.metadata ?? {}),
        createdAt: now(),
      })
      .returning()
      .get();
    return row;
  }

  async listAuditEvents(filter?: { rfqId?: number; limit?: number }): Promise<AuditEventHydrated[]> {
    const rows = filter?.rfqId
      ? db.select().from(auditEvents).where(eq(auditEvents.rfqId, filter.rfqId)).all()
      : db.select().from(auditEvents).all();
    rows.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
    const limited = typeof filter?.limit === "number" ? rows.slice(0, filter.limit) : rows;
    return limited.map((row) => ({
      ...row,
      metadata: safeJson(row.metadata) as Record<string, unknown>,
    }));
  }

  async revokeInviteToken(
    inviteId: number,
    actor: { userId?: number | null; role: string; label: string },
  ): Promise<RfqInvite | undefined> {
    const invite = db.select().from(rfqInvites).where(eq(rfqInvites.id, inviteId)).get();
    if (!invite) return undefined;
    if (invite.tokenRevokedAt) return invite;
    const stamp = now();
    db.update(rfqInvites)
      .set({ tokenRevokedAt: stamp, updatedAt: stamp })
      .where(eq(rfqInvites.id, inviteId))
      .run();
    await this.logAudit({
      eventType: "token_revoked",
      rfqId: invite.rfqId,
      inviteId,
      actor,
      action: "revoke_portal_token",
      summary: `Portal token revoked for invite #${inviteId}`,
    });
    return db.select().from(rfqInvites).where(eq(rfqInvites.id, inviteId)).get();
  }

  async extendInviteToken(
    inviteId: number,
    actor: { userId?: number | null; role: string; label: string },
    extraBusinessDays = 5,
  ): Promise<RfqInvite | undefined> {
    const invite = db.select().from(rfqInvites).where(eq(rfqInvites.id, inviteId)).get();
    if (!invite) return undefined;
    const stamp = now();
    const newExpiry = defaultTokenExpiry(new Date(), extraBusinessDays);
    db.update(rfqInvites)
      .set({ tokenExpiresAt: newExpiry, tokenRevokedAt: null, updatedAt: stamp })
      .where(eq(rfqInvites.id, inviteId))
      .run();
    await this.logAudit({
      eventType: "token_extended",
      rfqId: invite.rfqId,
      inviteId,
      actor,
      action: "extend_portal_token",
      summary: `Portal token extended by ${extraBusinessDays} business days for invite #${inviteId}`,
      metadata: { newExpiry, extraBusinessDays },
    });
    return db.select().from(rfqInvites).where(eq(rfqInvites.id, inviteId)).get();
  }

  async touchUserLogin(id: number): Promise<User | undefined> {
    db.update(users).set({ lastLoginAt: now() }).where(eq(users.id, id)).run();
    return this.getUserById(id);
  }

  async listCompanies(): Promise<Company[]> {
    return db.select().from(companies).all();
  }

  async listFactories(): Promise<Factory[]> {
    return db.select().from(factories).all();
  }

  async listSubcontractors(): Promise<Subcontractor[]> {
    const rows = db.select().from(subcontractors).all();
    return rows.map(hydrateSubcontractor);
  }

  // Partner / client master data. Filtered to active rows; cluster filter is optional
  // so callers can show all partners (Senior Mgmt cross-cluster view) or limit to the
  // current requesting company's cluster (default for the create-RFQ picker).
  async listPartnerClients(filter?: { clusterName?: string | null }): Promise<PartnerClient[]> {
    const all = db.select().from(partnerClients).all();
    return all
      .filter((row) => row.active)
      .filter((row) => (filter?.clusterName ? row.clusterName === filter.clusterName : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async createSubcontractor(insertSubcontractor: InsertSubcontractor): Promise<Subcontractor> {
    const { clusterAccess, supportedCategories, vendorType, materialsSupplied, ...rest } =
      insertSubcontractor as InsertSubcontractor & {
        clusterAccess?: string[];
        supportedCategories?: string[];
        vendorType?: string;
        materialsSupplied?: string | null;
      };
    const row = db
      .insert(subcontractors)
      .values({
        ...rest,
        clusterAccess: JSON.stringify(clusterAccess ?? []),
        vendorType: vendorType ?? "manufacturing_subcontractor",
        supportedCategories: JSON.stringify(supportedCategories ?? []),
        materialsSupplied: materialsSupplied ?? null,
        createdAt: now(),
      } as any)
      .returning()
      .get();
    return hydrateSubcontractor(row);
  }

  async setSubcontractorClusterAccess(id: number, clusters: string[]): Promise<Subcontractor | undefined> {
    const existing = (()=>{const r=db.select().from(subcontractors).where(eq(subcontractors.id, id)).get(); return r ? hydrateSubcontractor(r) : null;})();
    if (!existing) return undefined;
    db.update(subcontractors)
      .set({ clusterAccess: JSON.stringify(clusters) })
      .where(eq(subcontractors.id, id))
      .run();
    const updated = (()=>{const r=db.select().from(subcontractors).where(eq(subcontractors.id, id)).get(); return r ? hydrateSubcontractor(r) : null;})();
    return updated ?? undefined;
  }

  async getSettings(): Promise<SystemSettings> {
    const row = db.select().from(systemSettings).get();
    if (row) {
      return {
        responseDefaultDays: row.responseDefaultDays,
        responseDayMode: (row.responseDayMode as ResponseDayMode) ?? "calendar",
        dealCloseDefaultDays: (row as any).dealCloseDefaultDays ?? 7,
        dealCloseDayMode: (((row as any).dealCloseDayMode as ResponseDayMode) ?? "calendar"),
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy ?? null,
      };
    }
    // First-run default: 1 calendar day (~24h) response window for ETD/RFQs;
    // 7 calendar days for the overall deal-close target.
    const inserted = db
      .insert(systemSettings)
      .values({
        responseDefaultDays: 1,
        responseDayMode: "calendar",
        dealCloseDefaultDays: 7,
        dealCloseDayMode: "calendar",
        updatedAt: now(),
        updatedBy: null,
      })
      .returning()
      .get();
    return {
      responseDefaultDays: inserted.responseDefaultDays,
      responseDayMode: (inserted.responseDayMode as ResponseDayMode) ?? "calendar",
      dealCloseDefaultDays: (inserted as any).dealCloseDefaultDays ?? 7,
      dealCloseDayMode: (((inserted as any).dealCloseDayMode as ResponseDayMode) ?? "calendar"),
      updatedAt: inserted.updatedAt,
      updatedBy: inserted.updatedBy ?? null,
    };
  }

  async updateSettings(
    patch: Partial<{
      responseDefaultDays: number;
      responseDayMode: ResponseDayMode;
      dealCloseDefaultDays: number;
      dealCloseDayMode: ResponseDayMode;
    }>,
    updatedBy: string,
  ): Promise<SystemSettings> {
    await this.getSettings();
    const row = db.select().from(systemSettings).get();
    if (!row) throw new Error("settings row missing after init");
    const next = {
      responseDefaultDays: patch.responseDefaultDays ?? row.responseDefaultDays,
      responseDayMode: (patch.responseDayMode ?? row.responseDayMode) as ResponseDayMode,
      dealCloseDefaultDays:
        patch.dealCloseDefaultDays ?? ((row as any).dealCloseDefaultDays ?? 7),
      dealCloseDayMode:
        (patch.dealCloseDayMode ?? ((row as any).dealCloseDayMode as ResponseDayMode) ?? "calendar") as ResponseDayMode,
      updatedAt: now(),
      updatedBy,
    };
    db.update(systemSettings)
      .set(next as any)
      .where(eq(systemSettings.id, row.id))
      .run();
    return next;
  }

  async setUserRole(id: number, role: string): Promise<User | undefined> {
    db.update(users).set({ role }).where(eq(users.id, id)).run();
    return this.getUserById(id);
  }

  async listRfqs(): Promise<Rfq[]> {
    return db.select().from(rfqs).all();
  }

  async getRfqDetail(id: number): Promise<RfqDetail | undefined> {
    const rfq = db.select().from(rfqs).where(eq(rfqs.id, id)).get();
    if (!rfq) return undefined;

    const requestingCompany = db.select().from(companies).where(eq(companies.id, rfq.requestingCompanyId)).get();
    const producingCompany = rfq.producingCompanyId
      ? db.select().from(companies).where(eq(companies.id, rfq.producingCompanyId)).get()
      : null;
    const producingFactory = rfq.producingFactoryId
      ? db.select().from(factories).where(eq(factories.id, rfq.producingFactoryId)).get()
      : null;

    const invites = db.select().from(rfqInvites).where(eq(rfqInvites.rfqId, id)).all();
    const detailedInvites: InviteWithDetails[] = invites.map((invite) => {
      const subcontractor = invite.subcontractorId && invite.subcontractorId > 0
        ? (()=>{const r=db.select().from(subcontractors).where(eq(subcontractors.id, invite.subcontractorId)).get(); return r ? hydrateSubcontractor(r) : null;})()
        : null;
      const factory = invite.factoryId ? db.select().from(factories).where(eq(factories.id, invite.factoryId)).get() : null;
      const company = invite.companyId ? db.select().from(companies).where(eq(companies.id, invite.companyId)).get() : null;
      const inviteNegotiations = db.select().from(negotiations).where(eq(negotiations.inviteId, invite.id)).all();
      const recipientName = subcontractor?.name ?? factory?.name ?? company?.name ?? "Unassigned recipient";
      const recipientContact = subcontractor?.contactName ?? factory?.location ?? company?.clusterName ?? "Internal";
      const recipientEmail = subcontractor?.email ?? "Internal TEG request";
      return {
        ...invite,
        subcontractor,
        factory,
        company,
        recipientName,
        recipientContact,
        recipientEmail,
        negotiations: inviteNegotiations,
      };
    });

    return { rfq, requestingCompany, producingCompany, producingFactory, invites: detailedInvites };
  }

  // Generate the next RFQ code for a given category. Format: <PREFIX>-<YEAR>-<NNNN>.
  // Year is taken from now(); sequence is the next int after the largest existing
  // code for that prefix+year. We scan reference strings rather than maintaining a
  // counter table — simpler and safe enough for demo volume. Dedup is best-effort:
  // a unique constraint on rfqs.reference will reject any duplicate at insert time.
  private nextReferenceForCategory(category: RfqCategory): string {
    const prefix = RFQ_CODE_PREFIX[category] ?? "RFQ";
    const year = new Date().getUTCFullYear();
    const all = db.select({ reference: rfqs.reference }).from(rfqs).all();
    const re = new RegExp(`^${prefix}-${year}-(\\d+)$`);
    let max = 0;
    for (const row of all) {
      const m = re.exec(row.reference ?? "");
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > max) max = n;
      }
    }
    const seq = String(max + 1).padStart(4, "0");
    return `${prefix}-${year}-${seq}`;
  }

  async createRfq(insertRfq: InsertRfq): Promise<Rfq> {
    const parsed = insertRfqSchema.parse(insertRfq);
    const requestingCompany = db.select().from(companies).where(eq(companies.id, parsed.requestingCompanyId)).get();
    const defaults = defaultsForRequestType(parsed.requestType);
    // Honour the configurable response window (default days + day mode).
    const settings = await this.getSettings();
    const responseDue =
      parsed.responseDue && parsed.responseDue.trim()
        ? parsed.responseDue
        : defaultResponseDue(new Date(), settings.responseDefaultDays, settings.responseDayMode);
    // Default expiry to end-of-business on the responseDue date (UTC for storage; UI renders local).
    const expiresAt = `${responseDue}T17:00:00.000Z`;
    // Deal close target — overall RFQ close-by deadline (default 7 calendar days from
    // creation). Distinct from responseDue (the initial 24-hour response window).
    const createdAtIso = now();
    const dealCloseDue = defaultDealCloseDue(
      createdAtIso,
      settings.dealCloseDefaultDays,
      settings.dealCloseDayMode,
    );

    // Resolve effective category. Internal-ETD / intercompany requests always belong to
    // manufacturing_subcontractor (factory production work). External RFQs honour the
    // submitted category and default to manufacturing_subcontractor when none is given.
    const submittedCategory = (parsed as InsertRfq & { category?: RfqCategory }).category;
    const category: RfqCategory =
      parsed.requestType === "internal_etd" || parsed.requestType === "intercompany"
        ? "manufacturing_subcontractor"
        : (submittedCategory ?? "manufacturing_subcontractor");

    // Category ↔ request type lock: internal/intercompany are reserved for manufacturing
    // (Product Manufacturing). All other categories (pallets, polybags, cardboard,
    // packaging, logistics, other) are external-vendor only — they cannot be requested
    // as Internal Factory ETD or Intercompany Production. The auto-snap above keeps the
    // happy path clean; this check rejects an explicit non-manufacturing category that
    // somehow still pairs with internal/intercompany request type.
    if (
      (parsed.requestType === "internal_etd" || parsed.requestType === "intercompany") &&
      submittedCategory &&
      submittedCategory !== "manufacturing_subcontractor"
    ) {
      throw new RfqRoutingError(
        "Internal Factory ETD and Intercompany Production requests are only valid for Product Manufacturing. Other supplier categories must be sent as External Vendor RFQs.",
        422,
      );
    }
    if (parsed.requestType !== "external_rfq" && category !== "manufacturing_subcontractor") {
      throw new RfqRoutingError(
        "Supplier / material categories must use the External Vendor RFQ request type.",
        422,
      );
    }
    // Supplier RFQs always have visible price + price_etd negotiation — the internal
    // ETD-only price-hidden flow is reserved for factory/intercompany manufacturing.
    const isSupplierRfq =
      parsed.requestType === "external_rfq" && category !== "manufacturing_subcontractor";
    const priceVisibility = isSupplierRfq ? "visible" : defaults.priceVisibility;
    const negotiationScope = isSupplierRfq ? "price_etd" : defaults.negotiationScope;

    // Workflow + workflow-specific metadata. Wooden pallets and cardboard run as a
    // 6-month price-validity inquiry; polythene bags run as a polybag inquiry with
    // bag size / gauge / quantity / ETD-required specs that travel on the RFQ row.
    const workflowType = workflowForCategory(category);
    const isPriceValidity = workflowType === "price_validity_inquiry";
    const isPolybag = workflowType === "polybag_rfq";
    const submittedSpecs = (parsed as InsertRfq & { polybagSpecs?: PolybagSpecs | null }).polybagSpecs ?? null;
    const submittedManufacturing = (parsed as InsertRfq & { manufacturingSpecs?: ManufacturingSpecs | null }).manufacturingSpecs ?? null;
    const submittedProductLines = (parsed as InsertRfq & { productLines?: ProductLines | null }).productLines ?? null;
    if (isPolybag) {
      // New shape requires marketed L/W/H + actual L/W/H + gauge + ETD required.
      const ok =
        !!submittedSpecs &&
        !!submittedSpecs.marketedSize?.length &&
        !!submittedSpecs.marketedSize?.width &&
        !!submittedSpecs.marketedSize?.height &&
        !!submittedSpecs.actualSize?.length &&
        !!submittedSpecs.actualSize?.width &&
        !!submittedSpecs.actualSize?.height &&
        !!submittedSpecs.gauge &&
        !!submittedSpecs.etdRequired;
      if (!ok) {
        throw new RfqRoutingError(
          "Polythene bag inquiries require marketed size (L/W/H), actual bag size (L/W/H), gauge, and ETD required.",
          422,
        );
      }
    }
    // Product Manufacturing RFQs (external, internal_etd, intercompany) all require at
    // least one valid product line. Each line needs productType, materialSpecification,
    // size/weight, ecLevel, quantity, and loadabilityPerContainer. If the client only
    // supplied legacy single manufacturingSpecs we normalize it into one line using the
    // top-level quantity/unit fields (loadability per container is captured in `unit`
    // for manufacturing).
    const isManufacturingCategory = category === "manufacturing_subcontractor";
    let resolvedProductLines: ProductLine[] = [];
    if (isManufacturingCategory) {
      if (submittedProductLines && submittedProductLines.length > 0) {
        resolvedProductLines = submittedProductLines.map((line, idx) => {
          // Per-line productionSplits (new shape). Cleaned + min-2 validated.
          let cleanedSplits: ProductionSplitRow[] | null = null;
          const rawSplits = (line as any).productionSplits;
          if (rawSplits != null) {
            if (!Array.isArray(rawSplits)) {
              throw new RfqRoutingError(
                `Product line ${idx + 1}: productionSplits must be an array of {locationName, allocation, note?} rows.`,
                422,
              );
            }
            const ok: ProductionSplitRow[] = [];
            for (const r of rawSplits as Array<Record<string, unknown>>) {
              if (!r || typeof r !== "object") continue;
              const ln = typeof r.locationName === "string" ? r.locationName.trim() : "";
              const al = typeof r.allocation === "string" ? r.allocation.trim() : "";
              const nt = typeof r.note === "string" && r.note.trim() ? r.note.trim() : null;
              if (!ln || !al) {
                throw new RfqRoutingError(
                  `Product line ${idx + 1}: each split row needs a location name and an allocation.`,
                  422,
                );
              }
              ok.push({ locationName: ln, allocation: al, note: nt });
            }
            if (ok.length > 0 && ok.length < 2) {
              throw new RfqRoutingError(
                `Product line ${idx + 1}: add at least 2 split rows when splitting across multiple locations.`,
                422,
              );
            }
            cleanedSplits = ok.length >= 2 ? ok : null;
          }
          return {
            productType: line.productType,
            materialSpecification: line.materialSpecification.trim(),
            productSize: line.productSize.trim(),
            ecLevel: line.ecLevel.trim(),
            quantity: line.quantity.trim(),
            loadabilityPerContainer: line.loadabilityPerContainer.trim(),
            notes: line.notes?.trim() ? line.notes.trim() : null,
            productionSplits: cleanedSplits,
          };
        });
      } else if (submittedManufacturing) {
        // Legacy single-spec normalization. Top-level quantity/unit are the only signal we
        // have for line quantity/loadability — require both to be non-empty.
        const pt = submittedManufacturing.productType ?? null;
        if (!pt || !(MANUFACTURING_PRODUCT_TYPES as readonly string[]).includes(pt)) {
          throw new RfqRoutingError(
            "Pick a manufacturing product type (Growbags, Grow pots, Bales/Blocks, or Baggers).",
            422,
          );
        }
        const qty = (parsed.quantity ?? "").trim();
        const ldb = (parsed.unit ?? "").trim();
        if (
          !submittedManufacturing.materialSpecification ||
          !submittedManufacturing.productSize ||
          !submittedManufacturing.ecLevel ||
          !qty ||
          !ldb
        ) {
          throw new RfqRoutingError(
            "Product Manufacturing RFQs require at least one product line with material specification, size/weight, EC level, quantity, and loadability per container.",
            422,
          );
        }
        resolvedProductLines = [
          {
            productType: pt,
            materialSpecification: submittedManufacturing.materialSpecification.trim(),
            productSize: submittedManufacturing.productSize.trim(),
            ecLevel: submittedManufacturing.ecLevel.trim(),
            quantity: qty,
            loadabilityPerContainer: ldb,
            notes: null,
            productionSplits: null,
          },
        ];
      } else {
        throw new RfqRoutingError(
          "Product Manufacturing RFQs require at least one product line. Add a product (type, material, size/weight, EC, quantity, loadability per container).",
          422,
        );
      }
      // Per-line validation — the schema already enforces the basics, but reject blank
      // strings that would otherwise pass when the client trims whitespace away.
      resolvedProductLines.forEach((line, idx) => {
        if (
          !line.productType ||
          !line.materialSpecification ||
          !line.productSize ||
          !line.ecLevel ||
          !line.quantity ||
          !line.loadabilityPerContainer
        ) {
          throw new RfqRoutingError(
            `Product line ${idx + 1} is missing required fields. Each line needs product type, material specification, size/weight, EC level, quantity, and loadability per container.`,
            422,
          );
        }
      });
    }

    // Optional production splits — only allowed for manufacturing category. Validation
    // (min 2 rows) happens at the schema level; here we just gate the category.
    const submittedSplits = (parsed as InsertRfq & { productionSplits?: ProductionSplits | null }).productionSplits ?? null;
    if (submittedSplits && submittedSplits.length > 0 && !isManufacturingCategory) {
      throw new RfqRoutingError(
        "Production splits across multiple locations are only available for Product Manufacturing RFQs.",
        422,
      );
    }
    const submittedValidity = (parsed as InsertRfq & { priceValidityMonths?: number | null }).priceValidityMonths ?? null;
    const priceValidityMonths = isPriceValidity
      ? submittedValidity ?? DEFAULT_PRICE_VALIDITY_MONTHS
      : null;
    // Combined materialSpecs blob — polybag fields at top level for back-compat reads,
    // manufacturing under .manufacturing.
    const specsBlob: Record<string, unknown> = {};
    if (submittedSpecs) {
      specsBlob.marketedSize = submittedSpecs.marketedSize;
      specsBlob.actualSize = submittedSpecs.actualSize;
      specsBlob.gauge = submittedSpecs.gauge;
      specsBlob.etdRequired = submittedSpecs.etdRequired;
      if (submittedSpecs.bagSize) specsBlob.bagSize = submittedSpecs.bagSize;
    }
    if (isManufacturingCategory && resolvedProductLines.length > 0) {
      specsBlob.productLines = resolvedProductLines;
      // Mirror the first line's spec into the legacy `manufacturing` field so older
      // read paths (notifications, portals, detail pages that haven't migrated) still
      // surface the primary product without breaking.
      const first = resolvedProductLines[0];
      specsBlob.manufacturing = {
        materialSpecification: first.materialSpecification,
        productSize: first.productSize,
        ecLevel: first.ecLevel,
        productType: first.productType,
      };
    } else if (submittedManufacturing) {
      specsBlob.manufacturing = submittedManufacturing;
    }
    if (submittedSplits && submittedSplits.length > 0 && isManufacturingCategory) {
      specsBlob.productionSplits = submittedSplits;
    }
    const materialSpecs = Object.keys(specsBlob).length > 0 ? JSON.stringify(specsBlob) : "{}";

    // Product Manufacturing PO context. Required only for manufacturing RFQs.
    // The legacy projectName / packageName / description columns are still
    // notNull TEXT — we derive readable values from the partner / customer
    // / product list so summary screens, audit logs, and notifications keep
    // working without dual-writes everywhere. Non-manufacturing RFQs continue
    // to use the user-supplied projectName / packageName / description fields.
    const submittedPartner = (parsed as InsertRfq & { partnerClient?: string | null }).partnerClient ?? null;
    const submittedPoCountry = (parsed as InsertRfq & { poCountry?: string | null }).poCountry ?? null;
    const submittedPoCustomer = (parsed as InsertRfq & { poCustomerName?: string | null }).poCustomerName ?? null;
    let derivedProjectName = (parsed.projectName ?? "").trim();
    let derivedPackageName = (parsed.packageName ?? "").trim();
    let derivedDescription = (parsed.description ?? "").trim();
    let derivedQuantity = (parsed.quantity ?? "").trim();
    let derivedUnit = (parsed.unit ?? "").trim();
    if (isManufacturingCategory) {
      const partner = submittedPartner?.trim();
      const poCountry = submittedPoCountry?.trim();
      const poCustomer = submittedPoCustomer?.trim();
      if (!partner) {
        throw new RfqRoutingError(
          "Partner / Client is required for Product Manufacturing RFQs (the partner who issued the PO).",
          422,
        );
      }
      if (!poCountry) {
        throw new RfqRoutingError(
          "Country is required for Product Manufacturing RFQs.",
          422,
        );
      }
      if (!poCustomer) {
        throw new RfqRoutingError(
          "Customer Name (as stated on the PO) is required for Product Manufacturing RFQs.",
          422,
        );
      }
      // Auto-populate the legacy display columns. The notNull constraint at the DB
      // level is satisfied with a deterministic, readable fallback. If the client
      // explicitly supplied legacy projectName / packageName / description (e.g. an
      // older API caller) we still keep their values as overrides.
      if (!derivedProjectName) {
        derivedProjectName = `${partner} — ${poCustomer}`.slice(0, 240);
      }
      if (!derivedPackageName) {
        const lineSummary =
          resolvedProductLines.length > 1
            ? `${resolvedProductLines.length} product lines`
            : resolvedProductLines.length === 1
              ? `${MANUFACTURING_PRODUCT_TYPES.includes(resolvedProductLines[0].productType as any) ? resolvedProductLines[0].productType.replace(/_/g, " ") : "Product manufacturing"}`
              : "Product manufacturing";
        derivedPackageName = `PO order — ${lineSummary}`.slice(0, 200);
      }
      if (!derivedDescription) {
        derivedDescription = [
          `Product Manufacturing order following purchase order from ${partner} (${poCountry}).`,
          `Customer named on PO: ${poCustomer}.`,
          resolvedProductLines.length > 1
            ? `Order covers ${resolvedProductLines.length} product lines — see the product list for full specs.`
            : resolvedProductLines.length === 1
              ? `Material spec: ${resolvedProductLines[0].materialSpecification}.`
              : null,
        ]
          .filter(Boolean)
          .join(" ");
      }
      if (!derivedQuantity) {
        derivedQuantity = resolvedProductLines.length > 1
          ? "Multiple products"
          : resolvedProductLines[0]?.quantity ?? "";
      }
      if (!derivedUnit) {
        derivedUnit = resolvedProductLines.length > 1
          ? "see product lines"
          : resolvedProductLines[0]?.loadabilityPerContainer ?? "";
      }
    } else {
      // Non-manufacturing categories still require the legacy generic fields. Reject
      // here so the dashboard never persists empty strings for these columns.
      if (!derivedProjectName) {
        throw new RfqRoutingError("Project name is required.", 422);
      }
      if (!derivedPackageName) {
        throw new RfqRoutingError("Order / package name is required.", 422);
      }
      if (!derivedDescription) {
        throw new RfqRoutingError("Scope description is required.", 422);
      }
      if (!derivedQuantity) {
        throw new RfqRoutingError("Quantity is required.", 422);
      }
      if (!derivedUnit) {
        throw new RfqRoutingError("Unit is required.", 422);
      }
    }

    // Strip extension-only fields so they don't end up in the spread — they live in
    // dedicated columns or in materialSpecs.
    const {
      polybagSpecs: _ignoreSpecs,
      manufacturingSpecs: _ignoreMfg,
      productLines: _ignoreLines,
      productionSplits: _ignoreSplits,
      priceValidityMonths: _ignoreValidity,
      reference: submittedReference,
      partnerClient: _ignorePartner,
      poCountry: _ignorePoCountry,
      poCustomerName: _ignorePoCustomer,
      projectName: _ignoreProject,
      packageName: _ignorePackage,
      description: _ignoreDescription,
      quantity: _ignoreQuantity,
      unit: _ignoreUnit,
      ...rest
    } = parsed as InsertRfq & {
      polybagSpecs?: PolybagSpecs | null;
      manufacturingSpecs?: ManufacturingSpecs | null;
      productLines?: ProductLines | null;
      productionSplits?: ProductionSplits | null;
      priceValidityMonths?: number | null;
      reference?: string | null;
      partnerClient?: string | null;
      poCountry?: string | null;
      poCustomerName?: string | null;
    };
    // Reference: prefer client-supplied non-empty value (legacy compat), else server-generate.
    let reference = submittedReference && submittedReference.trim() ? submittedReference.trim() : this.nextReferenceForCategory(category);
    // Best-effort dedup if the supplied / generated value collides.
    let attempts = 0;
    while (db.select().from(rfqs).where(eq(rfqs.reference, reference)).get() && attempts < 50) {
      reference = this.nextReferenceForCategory(category);
      attempts += 1;
    }
    const created = db
      .insert(rfqs)
      .values({
        ...rest,
        reference,
        category,
        responseDue,
        projectName: derivedProjectName,
        packageName: derivedPackageName,
        description: derivedDescription,
        quantity: derivedQuantity,
        unit: derivedUnit,
        producingCompanyId: parsed.producingCompanyId ?? null,
        producingFactoryId: parsed.producingFactoryId ?? null,
        clusterName: clusterForCompany(requestingCompany),
        priceVisibility,
        negotiationScope,
        escalationSourceRfqId: null,
        escalationReason: null,
        expiresAt,
        dealCloseDue,
        status: "draft",
        workflowType,
        priceValidityMonths,
        materialSpecs,
        partnerClient: isManufacturingCategory ? submittedPartner!.trim() : null,
        poCountry: isManufacturingCategory ? submittedPoCountry!.trim() : null,
        poCustomerName: isManufacturingCategory ? submittedPoCustomer!.trim() : null,
        createdAt: createdAtIso,
      })
      .returning()
      .get();

    // Rev 0 baseline: record the original RFQ as the first amendment row so the
    // version history starts from creation. The internal summary captures the
    // creation context; the safe summary is portal-friendly. notifiedRecipients
    // is 0 — vendors are notified separately when invites are sent.
    try {
      await this.recordRfqAmendment({
        rfqId: created.id,
        changedBy: "system",
        changedByRole: "system",
        reason: null,
        safeSummary: `Original RFQ ${created.reference} created.`,
        internalSummary: `Original RFQ ${created.reference} (${created.projectName ?? created.packageName}) created. Category: ${(created as any).category ?? "manufacturing_subcontractor"}.`,
        changedFields: [],
        notifiedRecipients: 0,
        isBaseline: true,
      });
    } catch (err) {
      // Baseline failure is non-fatal — the RFQ still exists, history just won't
      // include Rev 0. Surface to logs.
      console.warn("Failed to record Rev 0 baseline:", err);
    }
    return created;
  }

  async updateRfq(
    rfqId: number,
    patchInput: UpdateRfq,
    actor: { userId?: number | null; role: string; label: string },
  ): Promise<{ rfq: Rfq; changedFields: string[] } | undefined> {
    const parsed = updateRfqSchema.parse(patchInput);
    const existing = db.select().from(rfqs).where(eq(rfqs.id, rfqId)).get();
    if (!existing) return undefined;

    if (existing.status === "awarded" || existing.status === "accepted" || existing.status === "closed") {
      throw new RfqRoutingError(
        "This RFQ has been awarded or closed and cannot be edited.",
        409,
      );
    }

    const inviteCount = db.select().from(rfqInvites).where(eq(rfqInvites.rfqId, rfqId)).all().length;
    const hasInvites = inviteCount > 0;

    // Category / requestType / requestingCompanyId can only change before invites exist.
    if (hasInvites) {
      if (parsed.category && parsed.category !== existing.category) {
        throw new RfqRoutingError(
          "Category cannot be changed after invites have been sent. Close the RFQ and create a new one.",
          409,
        );
      }
      if (parsed.requestType && parsed.requestType !== existing.requestType) {
        throw new RfqRoutingError(
          "Request type cannot be changed after invites have been sent.",
          409,
        );
      }
      if (parsed.requestingCompanyId && parsed.requestingCompanyId !== existing.requestingCompanyId) {
        throw new RfqRoutingError(
          "Requesting company cannot be changed after invites have been sent.",
          409,
        );
      }
    }

    // Pre-invite category ↔ requestType lock. The same rules as createRfq apply here:
    // internal/intercompany are reserved for manufacturing; non-manufacturing categories
    // must use external_rfq. We resolve the proposed values from `parsed` falling back to
    // existing values.
    {
      const proposedRequestType = parsed.requestType ?? existing.requestType;
      const proposedCategory = (parsed.category ?? (existing.category as RfqCategory)) as RfqCategory;
      if (
        (proposedRequestType === "internal_etd" || proposedRequestType === "intercompany") &&
        proposedCategory !== "manufacturing_subcontractor"
      ) {
        throw new RfqRoutingError(
          "Internal Factory ETD and Intercompany Production are only valid for Product Manufacturing.",
          422,
        );
      }
      if (proposedRequestType !== "external_rfq" && proposedCategory !== "manufacturing_subcontractor") {
        throw new RfqRoutingError(
          "Supplier / material categories must use External Vendor RFQ as the request type.",
          422,
        );
      }
    }

    const update: Partial<typeof rfqs.$inferInsert> = {};
    const changed: string[] = [];

    const setIf = (key: keyof typeof rfqs.$inferInsert, value: unknown, before: unknown) => {
      if (value === undefined) return;
      if ((value ?? null) === (before ?? null)) return;
      (update as any)[key] = value;
      changed.push(String(key));
    };

    setIf("projectName", parsed.projectName, existing.projectName);
    setIf("packageName", parsed.packageName, existing.packageName);
    setIf("description", parsed.description, existing.description);
    setIf("quantity", parsed.quantity, existing.quantity);
    setIf("unit", parsed.unit, existing.unit);
    setIf("targetEtd", parsed.targetEtd, existing.targetEtd);
    // Product Manufacturing PO context. Edits flow even when invites already exist
    // (it's commercial context, not routing) so recipients are notified about the
    // partner / customer change. nextCategory tracks the resolved category.
    if (parsed.partnerClient !== undefined) {
      const next = parsed.partnerClient && parsed.partnerClient.trim() ? parsed.partnerClient.trim() : null;
      if (next !== ((existing as any).partnerClient ?? null)) {
        (update as any).partnerClient = next;
        changed.push("partnerClient");
      }
    }
    if (parsed.poCountry !== undefined) {
      const next = parsed.poCountry && parsed.poCountry.trim() ? parsed.poCountry.trim() : null;
      if (next !== ((existing as any).poCountry ?? null)) {
        (update as any).poCountry = next;
        changed.push("poCountry");
      }
    }
    if (parsed.poCustomerName !== undefined) {
      const next = parsed.poCustomerName && parsed.poCustomerName.trim() ? parsed.poCustomerName.trim() : null;
      if (next !== ((existing as any).poCustomerName ?? null)) {
        (update as any).poCustomerName = next;
        changed.push("poCustomerName");
      }
    }

    if (parsed.responseDue !== undefined) {
      const responseDue = parsed.responseDue && parsed.responseDue.trim() ? parsed.responseDue : existing.responseDue;
      if (responseDue !== existing.responseDue) {
        update.responseDue = responseDue;
        update.expiresAt = `${responseDue}T17:00:00.000Z`;
        changed.push("responseDue");
      }
    }

    if (parsed.priceValidityMonths !== undefined) {
      const next = parsed.priceValidityMonths ?? null;
      if (next !== (existing as any).priceValidityMonths) {
        (update as any).priceValidityMonths = next;
        changed.push("priceValidityMonths");
      }
    }

    // Pre-invite category / requestType / company changes — will recompute workflow & visibility.
    let nextCategory: RfqCategory = (existing.category as RfqCategory) ?? "manufacturing_subcontractor";
    let nextRequestType = existing.requestType;
    if (!hasInvites) {
      if (parsed.category && parsed.category !== existing.category) {
        nextCategory = parsed.category;
        update.category = parsed.category;
        changed.push("category");
      }
      if (parsed.requestType && parsed.requestType !== existing.requestType) {
        nextRequestType = parsed.requestType;
        update.requestType = parsed.requestType;
        changed.push("requestType");
      }
      if (parsed.requestingCompanyId && parsed.requestingCompanyId !== existing.requestingCompanyId) {
        update.requestingCompanyId = parsed.requestingCompanyId;
        const company = db.select().from(companies).where(eq(companies.id, parsed.requestingCompanyId)).get();
        update.clusterName = clusterForCompany(company);
        changed.push("requestingCompanyId");
      }
      if (parsed.producingCompanyId !== undefined) {
        update.producingCompanyId = parsed.producingCompanyId ?? null;
        if ((parsed.producingCompanyId ?? null) !== (existing.producingCompanyId ?? null)) changed.push("producingCompanyId");
      }
      if (parsed.producingFactoryId !== undefined) {
        update.producingFactoryId = parsed.producingFactoryId ?? null;
        if ((parsed.producingFactoryId ?? null) !== (existing.producingFactoryId ?? null)) changed.push("producingFactoryId");
      }
      // Recompute workflow + price-visibility if category / requestType moved.
      if (changed.includes("category") || changed.includes("requestType")) {
        const wf = workflowForCategory(nextCategory);
        update.workflowType = wf;
        // External supplier RFQs always have visible price; internal manufacturing keeps existing rules.
        const isSupplier = nextRequestType === "external_rfq" && nextCategory !== "manufacturing_subcontractor";
        const def = defaultsForRequestType(nextRequestType);
        update.priceVisibility = isSupplier ? "visible" : def.priceVisibility;
        update.negotiationScope = isSupplier ? "price_etd" : def.negotiationScope;
      }
    }

    // Spec edits — merge into materialSpecs blob.
    let specsChanged = false;
    const existingSpecs = (() => {
      try { return JSON.parse((existing as any).materialSpecs ?? "{}"); } catch { return {}; }
    })();
    const nextSpecs: Record<string, unknown> = { ...existingSpecs };
    if (parsed.polybagSpecs !== undefined) {
      if (parsed.polybagSpecs === null) {
        delete nextSpecs.marketedSize;
        delete nextSpecs.actualSize;
        delete nextSpecs.gauge;
        delete nextSpecs.etdRequired;
        delete nextSpecs.bagSize;
        specsChanged = true;
      } else {
        nextSpecs.marketedSize = parsed.polybagSpecs.marketedSize;
        nextSpecs.actualSize = parsed.polybagSpecs.actualSize;
        nextSpecs.gauge = parsed.polybagSpecs.gauge;
        nextSpecs.etdRequired = parsed.polybagSpecs.etdRequired;
        if (parsed.polybagSpecs.bagSize) nextSpecs.bagSize = parsed.polybagSpecs.bagSize;
        specsChanged = true;
      }
    }
    if (parsed.manufacturingSpecs !== undefined) {
      if (parsed.manufacturingSpecs === null) {
        delete nextSpecs.manufacturing;
      } else {
        // Validate productType if provided.
        const pt = parsed.manufacturingSpecs.productType ?? null;
        if (pt && !(MANUFACTURING_PRODUCT_TYPES as readonly string[]).includes(pt as string)) {
          throw new RfqRoutingError(
            "Unknown manufacturing product type. Use Growbags, Grow pots, Bales/Blocks, or Baggers.",
            422,
          );
        }
        nextSpecs.manufacturing = parsed.manufacturingSpecs;
      }
      specsChanged = true;
    }
    if (parsed.productLines !== undefined) {
      if (parsed.productLines === null) {
        delete nextSpecs.productLines;
        specsChanged = true;
      } else {
        if (nextCategory !== "manufacturing_subcontractor") {
          throw new RfqRoutingError(
            "Product lines are only available on Product Manufacturing RFQs.",
            422,
          );
        }
        const cleaned: ProductLine[] = parsed.productLines.map((line, idx) => {
          if (
            !line.productType ||
            !(MANUFACTURING_PRODUCT_TYPES as readonly string[]).includes(line.productType)
          ) {
            throw new RfqRoutingError(
              `Product line ${idx + 1}: pick a valid product type (Growbags, Grow pots, Bales/Blocks, or Baggers).`,
              422,
            );
          }
          const mat = line.materialSpecification?.trim() ?? "";
          const sz = line.productSize?.trim() ?? "";
          const ec = line.ecLevel?.trim() ?? "";
          const qty = line.quantity?.trim() ?? "";
          const ldb = line.loadabilityPerContainer?.trim() ?? "";
          if (!mat || !sz || !ec || !qty || !ldb) {
            throw new RfqRoutingError(
              `Product line ${idx + 1} is missing required fields. Each line needs material specification, size/weight, EC level, quantity, and loadability per container.`,
              422,
            );
          }
          // Per-line productionSplits. null/undefined = no split. Array with rows must
          // have >=2 valid rows (location + allocation). Reject malformed input with 422.
          const rawSplits = (line as { productionSplits?: unknown }).productionSplits;
          let cleanedSplits: ProductionSplitRow[] | null = null;
          if (rawSplits != null) {
            if (!Array.isArray(rawSplits)) {
              throw new RfqRoutingError(
                `Product line ${idx + 1}: productionSplits must be an array of {locationName, allocation, note?} rows.`,
                422,
              );
            }
            const ok: ProductionSplitRow[] = [];
            for (const r of rawSplits as Array<Record<string, unknown>>) {
              if (!r || typeof r !== "object") continue;
              const ln = typeof r.locationName === "string" ? r.locationName.trim() : "";
              const al = typeof r.allocation === "string" ? r.allocation.trim() : "";
              const nt = typeof r.note === "string" && r.note.trim() ? r.note.trim() : null;
              if (!ln || !al) {
                throw new RfqRoutingError(
                  `Product line ${idx + 1}: each split row needs a location name and an allocation.`,
                  422,
                );
              }
              ok.push({ locationName: ln, allocation: al, note: nt });
            }
            if (ok.length > 0 && ok.length < 2) {
              throw new RfqRoutingError(
                `Product line ${idx + 1}: add at least 2 split rows when splitting across multiple locations.`,
                422,
              );
            }
            cleanedSplits = ok.length >= 2 ? ok : null;
          }
          return {
            productType: line.productType,
            materialSpecification: mat,
            productSize: sz,
            ecLevel: ec,
            quantity: qty,
            loadabilityPerContainer: ldb,
            notes: line.notes?.trim() ? line.notes.trim() : null,
            productionSplits: cleanedSplits,
          };
        });
        nextSpecs.productLines = cleaned;
        // Keep legacy `manufacturing` mirror in sync with the first line so older
        // displays don't go blank.
        const first = cleaned[0];
        nextSpecs.manufacturing = {
          materialSpecification: first.materialSpecification,
          productSize: first.productSize,
          ecLevel: first.ecLevel,
          productType: first.productType,
        };
        specsChanged = true;
      }
    }
    if (parsed.productionSplits !== undefined) {
      // Splits are only valid on manufacturing RFQs (category is the resolved next value).
      if (parsed.productionSplits === null) {
        delete nextSpecs.productionSplits;
      } else {
        if (nextCategory !== "manufacturing_subcontractor") {
          throw new RfqRoutingError(
            "Production splits are only available on Product Manufacturing RFQs.",
            422,
          );
        }
        nextSpecs.productionSplits = parsed.productionSplits;
      }
      specsChanged = true;
    }
    if (specsChanged) {
      update.materialSpecs = JSON.stringify(nextSpecs);
      changed.push("materialSpecs");
    }

    if (changed.length === 0) {
      return { rfq: existing, changedFields: [] };
    }

    db.update(rfqs).set(update).where(eq(rfqs.id, rfqId)).run();
    const updated = db.select().from(rfqs).where(eq(rfqs.id, rfqId)).get();
    if (updated) {
      // Fan out rfq_updated notifications to all already-invited recipients + admin/commercial.
      await this.notifyRfqUpdated(rfqId, changed, actor.label);
      // Record a structured amendment row. The internal record carries each field's
      // before/after values; the safe summary is generic and never names admin-only
      // fields (PO / pricing quotation, internal notes, comparison data). Returns
      // are best-effort — history is informational and must not block the edit.
      try {
        // Build {field, before, after} entries. We exclude amendmentReason itself
        // (it's stored as `reason`) and we collapse JSON-shaped specs into a generic
        // marker so we don't dump nested arrays into the audit blob (still safe to
        // expose to internal roles, but kept compact).
        const beforeMap: Record<string, unknown> = {
          projectName: existing.projectName,
          packageName: existing.packageName,
          description: existing.description,
          quantity: existing.quantity,
          unit: existing.unit,
          targetEtd: existing.targetEtd,
          responseDue: existing.responseDue,
          priceValidityMonths: (existing as any).priceValidityMonths ?? null,
          category: existing.category,
          requestType: existing.requestType,
          requestingCompanyId: existing.requestingCompanyId,
          producingCompanyId: existing.producingCompanyId,
          producingFactoryId: existing.producingFactoryId,
          partnerClient: (existing as any).partnerClient ?? null,
          poCountry: (existing as any).poCountry ?? null,
          poCustomerName: (existing as any).poCustomerName ?? null,
          materialSpecs: "(updated—see RFQ specs)",
        };
        const afterMap: Record<string, unknown> = {
          projectName: updated.projectName,
          packageName: updated.packageName,
          description: updated.description,
          quantity: updated.quantity,
          unit: updated.unit,
          targetEtd: updated.targetEtd,
          responseDue: updated.responseDue,
          priceValidityMonths: (updated as any).priceValidityMonths ?? null,
          category: updated.category,
          requestType: updated.requestType,
          requestingCompanyId: updated.requestingCompanyId,
          producingCompanyId: updated.producingCompanyId,
          producingFactoryId: updated.producingFactoryId,
          partnerClient: (updated as any).partnerClient ?? null,
          poCountry: (updated as any).poCountry ?? null,
          poCustomerName: (updated as any).poCustomerName ?? null,
          materialSpecs: "(updated—see RFQ specs)",
        };
        const amendmentChangedFields: RfqAmendmentChangedField[] = changed.map((field) => ({
          field,
          before: beforeMap[field] ?? null,
          after: afterMap[field] ?? null,
        }));

        const reason = (parsed as any).amendmentReason ?? null;
        const safeFieldNames = changed
          .filter((f) => f !== "materialSpecs" && f !== "description")
          .map((f) => f.replace(/([A-Z])/g, " $1").trim().toLowerCase());
        const safeSummary = changed.length
          ? `RFQ details revised${safeFieldNames.length ? ` (${safeFieldNames.slice(0, 3).join(", ")}${safeFieldNames.length > 3 ? "…" : ""})` : ""}.`
          : "RFQ updated.";
        const internalSummary = reason
          ? `${reason} — changed: ${changed.join(", ")}.`
          : `Edited by ${actor.label}. Changed: ${changed.join(", ")}.`;

        // Count notified recipients (already-sent invites).
        const notifiedRecipients = inviteCount;

        await this.recordRfqAmendment({
          rfqId,
          changedBy: actor.label,
          changedByRole: actor.role,
          reason,
          safeSummary,
          internalSummary,
          changedFields: amendmentChangedFields,
          notifiedRecipients,
        });
      } catch (err) {
        console.warn("Failed to record RFQ amendment:", err);
      }
    }
    return updated ? { rfq: updated, changedFields: changed } : undefined;
  }

  private async notifyRfqUpdated(rfqId: number, changedFields: string[], actorLabel: string) {
    const rfq = db.select().from(rfqs).where(eq(rfqs.id, rfqId)).get();
    if (!rfq) return;
    const requestingCompany = db.select().from(companies).where(eq(companies.id, rfq.requestingCompanyId)).get();
    const summary = changedFields.length ? changedFields.join(", ") : "details";

    // Admin / buyer / commercial copy — includes change list.
    const isMfg = rfq.category === "manufacturing_subcontractor";
    const partnerLine = isMfg && (rfq as any).partnerClient
      ? `Partner / Client: ${(rfq as any).partnerClient}${(rfq as any).poCountry ? ` (${(rfq as any).poCountry})` : ""}.`
      : null;
    const customerLine = isMfg && (rfq as any).poCustomerName
      ? `Customer stated on PO: ${(rfq as any).poCustomerName}.`
      : null;
    this.insertNotification({
      rfqId,
      inviteId: null,
      notificationType: "rfq_updated",
      audience: "admin_buyer_commercial",
      audienceCompanyId: rfq.requestingCompanyId,
      recipientLabel: "TEG senior mgmt / commercial",
      subject: `[RFQ ${rfq.reference}] Updated by ${actorLabel}`,
      body: [
        `Hi team,`,
        ``,
        `RFQ ${rfq.reference} (${rfq.packageName}) was edited by ${actorLabel}.`,
        `Changed: ${summary}.`,
        isMfg ? null : `Project: ${rfq.projectName}.`,
        partnerLine,
        customerLine,
        `Response due: ${rfq.responseDue} · Target ETD: ${rfq.targetEtd}.`,
        ``,
        `Open the RFQ to review the latest details.`,
      ].filter(Boolean).join("\n"),
    });

    // Per-invite recipient copies. Uses the same materialSpecs body but never leaks
    // hidden price / admin-only docs (we never embed those here).
    const invites = db.select().from(rfqInvites).where(eq(rfqInvites.rfqId, rfqId)).all();
    for (const invite of invites) {
      if (invite.recipientType === "external_subcontractor" && invite.subcontractorId && invite.subcontractorId > 0) {
        const subRow = db.select().from(subcontractors).where(eq(subcontractors.id, invite.subcontractorId)).get();
        if (!subRow) continue;
        this.insertNotification({
          rfqId,
          inviteId: invite.id,
          notificationType: "rfq_updated",
          audience: "subcontractor_invite",
          audienceInviteId: invite.id,
          recipientLabel: subRow.name,
          subject: `RFQ ${rfq.reference} updated`,
          body: [
            `Hello ${subRow.contactName ?? subRow.name},`,
            ``,
            `${requestingCompany?.name ?? "TEG"} updated the details on RFQ ${rfq.reference} (${rfq.packageName}).`,
            `Changed: ${summary}.`,
            `Response due: ${rfq.responseDue} · Target ETD: ${rfq.targetEtd}.`,
            ``,
            `Please re-open your tokenized portal link to review the latest specs.`,
          ].join("\n"),
        });
      } else if (invite.recipientType === "internal_factory" && invite.factoryId) {
        const factory = db.select().from(factories).where(eq(factories.id, invite.factoryId)).get();
        if (!factory) continue;
        this.insertNotification({
          rfqId,
          inviteId: invite.id,
          notificationType: "rfq_updated",
          audience: "factory",
          audienceFactoryId: invite.factoryId,
          recipientLabel: factory.name,
          subject: `RFQ ${rfq.reference} updated for ${factory.name}`,
          body: [
            `Hello ${factory.name},`,
            ``,
            `${requestingCompany?.name ?? "TEG"} updated RFQ ${rfq.reference} (${rfq.packageName}).`,
            `Changed: ${summary}.`,
            `Response due: ${rfq.responseDue} · Target ETD: ${rfq.targetEtd}.`,
            ``,
            `Confirm or revise the earliest dispatch date in the dashboard. Pricing remains hidden.`,
          ].join("\n"),
        });
      } else if (invite.recipientType === "internal_company" && invite.companyId) {
        const company = db.select().from(companies).where(eq(companies.id, invite.companyId)).get();
        if (!company) continue;
        this.insertNotification({
          rfqId,
          inviteId: invite.id,
          notificationType: "rfq_updated",
          audience: "factory",
          audienceCompanyId: invite.companyId,
          recipientLabel: company.name,
          subject: `RFQ ${rfq.reference} updated for ${company.name}`,
          body: [
            `Hello ${company.name} team,`,
            ``,
            `${requestingCompany?.name ?? "TEG"} updated intercompany RFQ ${rfq.reference}.`,
            `Changed: ${summary}.`,
            `Response due: ${rfq.responseDue} · Target ETD: ${rfq.targetEtd}.`,
          ].join("\n"),
        });
      }
    }
  }

  async inviteRecipient(rfqId: number, input: InsertInvite): Promise<RfqInvite> {
    const rfq = db.select().from(rfqs).where(eq(rfqs.id, rfqId)).get();
    if (!rfq) throw new Error("RFQ not found");

    if (rfq.status === "accepted" || rfq.status === "awarded" || rfq.status === "closed") {
      throw new RfqRoutingError(
        "This RFQ has already been awarded and is closed to new invites.",
        409,
      );
    }

    // Operating rule: Indian subcontractors can only be invited under Euro Substrates
    // (and the broader Tropicoir / Premier Tech cluster). Growrite Substrate cannot send
    // RFQs to Indian subcontractors because TEG does not operate under Growrite in India.
    // Country routing is enforced FIRST so country / company restrictions cannot be
    // overridden by a subcontractor's cluster-availability list.
    if (input.recipientType === "external_subcontractor" && input.subcontractorId) {
      const subcontractor = (()=>{const r=db.select().from(subcontractors).where(eq(subcontractors.id, input.subcontractorId)).get(); return r ? hydrateSubcontractor(r) : null;})();
      const requestingCompany = db
        .select()
        .from(companies)
        .where(eq(companies.id, rfq.requestingCompanyId))
        .get();
      if (subcontractor?.country === "India") {
        const blockedCodes = INDIA_BLOCKED_REQUESTING_COMPANY_CODES as readonly string[];
        if (requestingCompany && blockedCodes.includes(requestingCompany.code)) {
          throw new RfqRoutingError(INDIA_BLOCKED_MESSAGE, 422);
        }
      }
      // Cluster-availability rule: a subcontractor with an explicit clusterAccess list must
      // include the requesting company's cluster. Empty / missing list = available to BOTH clusters.
      if (subcontractor && requestingCompany) {
        if (!isSubcontractorAvailableForCluster(subcontractor.clusterAccess, requestingCompany.clusterName)) {
          throw new RfqRoutingError(SUBCONTRACTOR_CLUSTER_BLOCKED_MESSAGE, 422);
        }
      }
      // Vendor-category compatibility: manufacturing RFQs may only invite manufacturing
      // subcontractors; supplier RFQs may only invite suppliers whose supportedCategories
      // include the RFQ's category.
      if (subcontractor) {
        const rfqCategory = ((rfq as Rfq & { category?: string }).category ?? "manufacturing_subcontractor") as RfqCategory;
        if (
          !isVendorAllowedForCategory(
            subcontractor.vendorType,
            subcontractor.supportedCategories as string[],
            rfqCategory,
          )
        ) {
          throw new RfqRoutingError(VENDOR_CATEGORY_BLOCKED_MESSAGE, 422);
        }
      }
    }

    const existingInvites = db
      .select()
      .from(rfqInvites)
      .where(and(eq(rfqInvites.rfqId, rfqId), eq(rfqInvites.recipientType, input.recipientType)))
      .all();
    const existing = existingInvites.find((candidate) => {
      if (input.recipientType === "external_subcontractor") {
        return candidate.subcontractorId === (input.subcontractorId ?? null);
      }
      if (input.recipientType === "internal_factory") {
        return candidate.factoryId === (input.factoryId ?? null);
      }
      return candidate.companyId === (input.companyId ?? null);
    });
    if (existing) return existing;

    const subcontractor = input.subcontractorId
      ? (()=>{const r=db.select().from(subcontractors).where(eq(subcontractors.id, input.subcontractorId)).get(); return r ? hydrateSubcontractor(r) : null;})()
      : null;
    const factory = input.factoryId ? db.select().from(factories).where(eq(factories.id, input.factoryId)).get() : null;
    const company = input.companyId ? db.select().from(companies).where(eq(companies.id, input.companyId)).get() : null;

    const isExternal = input.recipientType === "external_subcontractor";
    const tokenExpiresAt = rfq.expiresAt ?? defaultTokenExpiry();
    const invite = db
      .insert(rfqInvites)
      .values({
        rfqId,
        recipientType: input.recipientType,
        subcontractorId: isExternal ? input.subcontractorId ?? null : 0,
        factoryId: input.factoryId ?? null,
        companyId: input.companyId ?? factory?.companyId ?? null,
        country: subcontractor?.country ?? factory?.country ?? "Sri Lanka",
        priceVisibility: isExternal ? "visible" : "hidden",
        negotiationScope: isExternal ? "price_etd" : "etd_only",
        token: compactToken(),
        status: "sent",
        currentPrice: null,
        currentEtd: null,
        lastNote: isExternal
          ? "External RFQ sent after internal ETD review or direct commercial inquiry."
          : `ETD-only request sent to ${factory?.name ?? company?.name ?? "internal recipient"}. No pricing is visible.`,
        closureReason: null,
        closedAt: null,
        tokenExpiresAt,
        tokenRevokedAt: null,
        lastAccessedAt: null,
        accessCount: 0,
        updatedAt: now(),
      })
      .returning()
      .get();

    await this.refreshRfqStatus(rfqId);
    // Trigger email-style notification fan-out.
    await this.notifyRfqSent(rfqId, invite.id);
    return invite;
  }

  async escalateToExternal(rfqId: number, subcontractorId: number, reason: string): Promise<RfqInvite> {
    const rfq = db.select().from(rfqs).where(eq(rfqs.id, rfqId)).get();
    if (!rfq) throw new Error("RFQ not found");

    const invite = await this.inviteRecipient(rfqId, {
      recipientType: "external_subcontractor",
      subcontractorId,
      factoryId: null,
      companyId: null,
    });

    db.update(rfqs)
      .set({
        status: "external_escalated",
        escalationReason: reason,
      })
      .where(eq(rfqs.id, rfqId))
      .run();

    const internalInvites = db
      .select()
      .from(rfqInvites)
      .where(and(eq(rfqInvites.rfqId, rfqId), eq(rfqInvites.negotiationScope, "etd_only")))
      .all();

    internalInvites.forEach((internalInvite) => {
      db.insert(negotiations)
        .values({
          inviteId: internalInvite.id,
          actor: "buyer",
          action: "escalate",
          price: null,
          etd: null,
          note: `Internal ETD was not favourable, so inquiry was also sent outside. Reason: ${reason}`,
          createdAt: now(),
        })
        .run();
    });

    return invite;
  }

  async getInviteById(id: number): Promise<RfqInvite | undefined> {
    return db.select().from(rfqInvites).where(eq(rfqInvites.id, id)).get();
  }

  async rfqIdsForFactory(factoryId: number): Promise<number[]> {
    const invites = db.select().from(rfqInvites).where(eq(rfqInvites.factoryId, factoryId)).all();
    return Array.from(new Set(invites.map((invite) => invite.rfqId)));
  }

  async rfqIdsForSubcontractor(subcontractorId: number): Promise<number[]> {
    const invites = db
      .select()
      .from(rfqInvites)
      .where(eq(rfqInvites.subcontractorId, subcontractorId))
      .all();
    return Array.from(
      new Set(
        invites
          .filter((invite) => invite.recipientType === "external_subcontractor")
          .map((invite) => invite.rfqId),
      ),
    );
  }

  async getInviteByToken(token: string): Promise<RfqDetail | undefined> {
    const invite = db.select().from(rfqInvites).where(eq(rfqInvites.token, token)).get();
    if (!invite) return undefined;
    const detail = await this.getRfqDetail(invite.rfqId);
    if (!detail) return undefined;
    return { ...detail, invites: detail.invites.filter((candidate) => candidate.id === invite.id) };
  }

  // Returns invite + computed token state. Bumps access counter when active.
  async resolveInviteByToken(token: string): Promise<
    | { detail: RfqDetail; invite: RfqInvite; tokenState: ReturnType<typeof computeTokenState> }
    | undefined
  > {
    const invite = db.select().from(rfqInvites).where(eq(rfqInvites.token, token)).get();
    if (!invite) return undefined;
    const tokenState = computeTokenState({
      tokenExpiresAt: invite.tokenExpiresAt,
      tokenRevokedAt: invite.tokenRevokedAt,
      inviteStatus: invite.status,
    });
    const detail = await this.getRfqDetail(invite.rfqId);
    if (!detail) return undefined;
    if (tokenState.kind === "active" || tokenState.kind === "negotiating") {
      db.update(rfqInvites)
        .set({
          lastAccessedAt: now(),
          accessCount: (invite.accessCount ?? 0) + 1,
        })
        .where(eq(rfqInvites.id, invite.id))
        .run();
    }
    return {
      detail: { ...detail, invites: detail.invites.filter((c) => c.id === invite.id) },
      invite,
      tokenState,
    };
  }

  async addNegotiation(input: InsertNegotiation): Promise<Negotiation> {
    const invite = db.select().from(rfqInvites).where(eq(rfqInvites.id, input.inviteId)).get();
    if (!invite) throw new Error("Invite not found");

    const nextStatus = statusForNegotiation(input.action, input.actor, invite);
    const price = invite.priceVisibility === "visible" ? input.price ?? invite.currentPrice : null;
    const etd = input.etd || invite.currentEtd;

    const negotiation = db
      .insert(negotiations)
      .values({
        inviteId: input.inviteId,
        actor: input.actor,
        action: input.action,
        price: invite.priceVisibility === "visible" ? input.price ?? null : null,
        etd: input.etd ?? null,
        note: input.note,
        createdAt: now(),
      })
      .returning()
      .get();

    db.update(rfqInvites)
      .set({
        status: nextStatus,
        currentPrice: price ?? null,
        currentEtd: etd ?? null,
        lastNote: input.note,
        updatedAt: now(),
      })
      .where(eq(rfqInvites.id, input.inviteId))
      .run();

    // Award/closure semantics: when a buyer or admin accepts an invite, that invite
    // becomes the awarded winner. Any other open invite on the same RFQ is closed
    // automatically with a default reason and the RFQ itself moves to "awarded".
    if (input.action === "accept" && (input.actor === "buyer")) {
      await this.awardInvite(invite.rfqId, input.inviteId);
    } else {
      await this.refreshRfqStatus(invite.rfqId);
    }
    // Notify on inbound quote / counter from subcontractor or factory.
    await this.notifyQuoteReceived({
      inviteId: input.inviteId,
      actor: input.actor,
      action: input.action,
      price: input.price ?? null,
      etd: input.etd ?? null,
      note: input.note,
    });
    return negotiation;
  }

  async awardInvite(
    rfqId: number,
    inviteId: number,
    manualReason?: string,
  ): Promise<RfqDetail | undefined> {
    const invite = db.select().from(rfqInvites).where(eq(rfqInvites.id, inviteId)).get();
    if (!invite || invite.rfqId !== rfqId) return undefined;

    const reason = (manualReason && manualReason.trim()) || DEFAULT_CLOSURE_REASON;
    const stamp = now();

    // Mark winner accepted/awarded.
    db.update(rfqInvites)
      .set({ status: "accepted", closureReason: null, closedAt: null, updatedAt: stamp })
      .where(eq(rfqInvites.id, inviteId))
      .run();

    // Close every other open invite on this RFQ with the closure reason.
    const others = db
      .select()
      .from(rfqInvites)
      .where(and(eq(rfqInvites.rfqId, rfqId), ne(rfqInvites.id, inviteId)))
      .all();

    for (const other of others) {
      if (other.status === "declined" || other.status === "closed") continue;
      db.update(rfqInvites)
        .set({
          status: "closed",
          closureReason: reason,
          closedAt: stamp,
          lastNote: reason,
          updatedAt: stamp,
        })
        .where(eq(rfqInvites.id, other.id))
        .run();
      db.insert(negotiations)
        .values({
          inviteId: other.id,
          actor: "buyer",
          action: "decline",
          price: null,
          etd: null,
          note: reason,
          createdAt: stamp,
        })
        .run();
    }

    db.update(rfqs)
      .set({ status: "awarded", awardedInviteId: inviteId, awardedAt: stamp })
      .where(eq(rfqs.id, rfqId))
      .run();

    // Generate winner + admin/buyer/commercial + closure notifications.
    await this.notifyAwardApproved(rfqId, inviteId, reason);

    return this.getRfqDetail(rfqId);
  }

  async setInviteClosure(inviteId: number, reason: string): Promise<RfqInvite | undefined> {
    const invite = db.select().from(rfqInvites).where(eq(rfqInvites.id, inviteId)).get();
    if (!invite) return undefined;
    const trimmed = reason.trim() || DEFAULT_CLOSURE_REASON;
    const stamp = now();
    db.update(rfqInvites)
      .set({ closureReason: trimmed, closedAt: invite.closedAt ?? stamp, updatedAt: stamp })
      .where(eq(rfqInvites.id, inviteId))
      .run();
    return db.select().from(rfqInvites).where(eq(rfqInvites.id, inviteId)).get();
  }

  async listAwardRecommendations(rfqId: number): Promise<AwardRecommendation[]> {
    return db
      .select()
      .from(awardRecommendations)
      .where(eq(awardRecommendations.rfqId, rfqId))
      .all()
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  }

  async getAwardRecommendation(id: number): Promise<AwardRecommendation | undefined> {
    return db
      .select()
      .from(awardRecommendations)
      .where(eq(awardRecommendations.id, id))
      .get();
  }

  async createAwardRecommendation(
    rfqId: number,
    role: string,
    input: InsertAwardRecommendation,
  ): Promise<AwardRecommendation> {
    const rfq = db.select().from(rfqs).where(eq(rfqs.id, rfqId)).get();
    if (!rfq) throw new RfqRoutingError("RFQ not found", 404);
    if (rfq.status === "awarded" || rfq.awardedInviteId) {
      throw new RfqRoutingError(
        "This RFQ has already been awarded. No further recommendations are needed.",
        409,
      );
    }

    const invite = db
      .select()
      .from(rfqInvites)
      .where(and(eq(rfqInvites.id, input.inviteId), eq(rfqInvites.rfqId, rfqId)))
      .get();
    if (!invite) {
      throw new RfqRoutingError("Recommended invite is not part of this RFQ", 404);
    }
    if (
      invite.status === "closed" ||
      invite.status === "declined" ||
      invite.status === "accepted" ||
      invite.status === "awarded"
    ) {
      throw new RfqRoutingError(
        "That invite is closed and cannot be recommended for award.",
        409,
      );
    }

    // Block creating a duplicate pending recommendation for the same RFQ.
    const pending = db
      .select()
      .from(awardRecommendations)
      .where(
        and(eq(awardRecommendations.rfqId, rfqId), eq(awardRecommendations.status, "pending")),
      )
      .get();
    if (pending) {
      throw new RfqRoutingError(
        "A pending recommendation already exists. Wait for TEG admin to approve, reject, or return it.",
        409,
      );
    }

    const created = db
      .insert(awardRecommendations)
      .values({
        rfqId,
        inviteId: input.inviteId,
        status: "pending",
        recommendedByRole: role,
        recommendedBy: input.recommendedBy?.trim() || null,
        rationale: input.rationale,
        proposedClosureReason: input.proposedClosureReason ?? null,
        decisionNote: null,
        decidedByRole: null,
        createdAt: now(),
        decidedAt: null,
      })
      .returning()
      .get();
    // Notify TEG admin only — recommendation pending decision.
    await this.notifyRecommendationPending(created);
    return created;
  }

  async decideAwardRecommendation(
    id: number,
    decision: "approved" | "rejected" | "returned",
    decidedByRole: string,
    decisionNote?: string,
    closureReasonOverride?: string,
  ): Promise<{ recommendation: AwardRecommendation; rfqDetail?: RfqDetail }> {
    const recommendation = db
      .select()
      .from(awardRecommendations)
      .where(eq(awardRecommendations.id, id))
      .get();
    if (!recommendation) {
      throw new RfqRoutingError("Recommendation not found", 404);
    }
    if (recommendation.status !== "pending") {
      throw new RfqRoutingError(
        "Only pending recommendations can be decided. This one is already " + recommendation.status + ".",
        409,
      );
    }

    const stamp = now();
    const trimmedNote = (decisionNote ?? "").trim() || null;

    db.update(awardRecommendations)
      .set({
        status: decision,
        decisionNote: trimmedNote,
        decidedByRole,
        decidedAt: stamp,
      })
      .where(eq(awardRecommendations.id, id))
      .run();

    let rfqDetail: RfqDetail | undefined;
    if (decision === "approved") {
      const closureReason =
        (closureReasonOverride && closureReasonOverride.trim()) ||
        (recommendation.proposedClosureReason ?? undefined);
      rfqDetail = await this.awardInvite(
        recommendation.rfqId,
        recommendation.inviteId,
        closureReason,
      );
    }

    const updated = db
      .select()
      .from(awardRecommendations)
      .where(eq(awardRecommendations.id, id))
      .get()!;
    return { recommendation: updated, rfqDetail };
  }

  async listRfqDocuments(rfqId: number): Promise<RfqDocumentMeta[]> {
    const rows = db.select().from(rfqDocuments).where(eq(rfqDocuments.rfqId, rfqId)).all();
    return rows
      .map(({ contentBase64: _omit, ...meta }) => meta as RfqDocumentMeta)
      .sort((a, b) => (a.uploadedAt > b.uploadedAt ? -1 : 1));
  }

  // Document requirement check (Product Manufacturing only). Returns booleans only —
  // never filenames, sizes, or metadata. Callable from invite-send / award routes
  // and from a thin status endpoint that vendors / factories can never reach.
  async getDocumentRequirementStatus(rfqId: number): Promise<DocumentRequirementStatus> {
    const rfq = db.select().from(rfqs).where(eq(rfqs.id, rfqId)).get();
    const isManufacturing =
      rfq && (rfq.category as string) === "manufacturing_subcontractor";
    const docs = db
      .select({ documentType: rfqDocuments.documentType })
      .from(rfqDocuments)
      .where(eq(rfqDocuments.rfqId, rfqId))
      .all();
    const present = new Set<string>(docs.map((d) => d.documentType));
    const byType = REQUIRED_MFG_DOC_TYPES.map((documentType) => ({
      documentType,
      present: present.has(documentType),
    }));
    const labelFor: Record<RfqDocumentType, string> = {
      purchase_order: "Purchase Order",
      pricing_quotation: "Pricing Quotation",
    };
    const missingLabels = byType.filter((b) => !b.present).map((b) => labelFor[b.documentType]);
    const required = Boolean(isManufacturing);
    const satisfied = !required || byType.every((b) => b.present);
    return { required, satisfied, byType, missingLabels };
  }

  // ---------- RFQ amendments / version history ----------
  // Internal record — always preserves the full structured changedFields list.
  async recordRfqAmendment(input: {
    rfqId: number;
    changedBy: string;
    changedByRole: string;
    reason?: string | null;
    safeSummary: string;
    internalSummary: string;
    changedFields: RfqAmendmentChangedField[];
    notifiedRecipients?: number;
    isBaseline?: boolean;
  }): Promise<RfqAmendment> {
    const existing = db
      .select({ revisionNumber: rfqAmendments.revisionNumber })
      .from(rfqAmendments)
      .where(eq(rfqAmendments.rfqId, input.rfqId))
      .all();
    let revisionNumber: number;
    if (input.isBaseline) {
      // Baseline (Rev 0) is only written when no other amendments exist.
      if (existing.length > 0) {
        // Already have a baseline (or later revisions) — no-op for idempotency.
        const latest = existing.sort((a, b) => a.revisionNumber - b.revisionNumber)[0];
        const row = db
          .select()
          .from(rfqAmendments)
          .where(eq(rfqAmendments.rfqId, input.rfqId))
          .all()
          .find((r) => r.revisionNumber === latest.revisionNumber);
        if (row) {
          return {
            ...row,
            changedFields: parseAmendmentChangedFields(row.changedFields),
          };
        }
      }
      revisionNumber = 0;
    } else {
      const max = existing.reduce((m, r) => Math.max(m, r.revisionNumber), -1);
      revisionNumber = max < 0 ? 1 : max + 1;
    }
    const inserted = db
      .insert(rfqAmendments)
      .values({
        rfqId: input.rfqId,
        revisionNumber,
        changedBy: input.changedBy,
        changedByRole: input.changedByRole,
        reason: input.reason ?? null,
        safeSummary: input.safeSummary,
        internalSummary: input.internalSummary,
        changedFields: JSON.stringify(input.changedFields ?? []),
        notifiedRecipients: input.notifiedRecipients ?? 0,
        createdAt: now(),
      })
      .returning()
      .get();
    return {
      ...inserted,
      changedFields: parseAmendmentChangedFields(inserted.changedFields),
    };
  }

  async listAmendments(rfqId: number): Promise<RfqAmendment[]> {
    const rows = db
      .select()
      .from(rfqAmendments)
      .where(eq(rfqAmendments.rfqId, rfqId))
      .all();
    return rows
      .map((row) => ({
        ...row,
        changedFields: parseAmendmentChangedFields(row.changedFields),
      }))
      .sort((a, b) => a.revisionNumber - b.revisionNumber);
  }

  // Portal-safe slice. Strips reason / changedFields / changedBy / role / internal
  // summary entirely — never sends those to vendors / factories.
  async listAmendmentsSafe(rfqId: number): Promise<RfqAmendmentSafe[]> {
    const rows = await this.listAmendments(rfqId);
    return rows.map((row) => ({
      id: row.id,
      rfqId: row.rfqId,
      revisionNumber: row.revisionNumber,
      safeSummary: row.safeSummary,
      createdAt: row.createdAt,
    }));
  }

  async getRfqDocument(rfqId: number, documentId: number): Promise<RfqDocument | undefined> {
    return db
      .select()
      .from(rfqDocuments)
      .where(and(eq(rfqDocuments.rfqId, rfqId), eq(rfqDocuments.id, documentId)))
      .get();
  }

  async saveRfqDocument(rfqId: number, role: string, input: InsertRfqDocument): Promise<RfqDocumentMeta> {
    const inserted = db
      .insert(rfqDocuments)
      .values({
        rfqId,
        documentType: input.documentType,
        filename: input.filename,
        mimeType: input.mimeType,
        size: input.size,
        contentBase64: input.contentBase64,
        uploadedBy: input.uploadedBy?.trim() || role,
        uploadedByRole: role,
        uploadedAt: now(),
      })
      .returning()
      .get();
    const { contentBase64: _omit, ...meta } = inserted;
    return meta as RfqDocumentMeta;
  }

  async deleteRfqDocument(rfqId: number, documentId: number): Promise<boolean> {
    const result = db
      .delete(rfqDocuments)
      .where(and(eq(rfqDocuments.rfqId, rfqId), eq(rfqDocuments.id, documentId)))
      .run();
    return (result.changes ?? 0) > 0;
  }

  // -------------------- Notifications --------------------

  // Insert a notification row. Always uses the current ISO timestamp.
  private insertNotification(args: {
    rfqId: number;
    inviteId?: number | null;
    recommendationId?: number | null;
    notificationType: NotificationType;
    audience: NotificationAudience;
    audienceCompanyId?: number | null;
    audienceFactoryId?: number | null;
    audienceInviteId?: number | null;
    recipientLabel: string;
    subject: string;
    body: string;
  }) {
    db.insert(notifications)
      .values({
        rfqId: args.rfqId,
        inviteId: args.inviteId ?? null,
        recommendationId: args.recommendationId ?? null,
        notificationType: args.notificationType,
        audience: args.audience,
        audienceCompanyId: args.audienceCompanyId ?? null,
        audienceFactoryId: args.audienceFactoryId ?? null,
        audienceInviteId: args.audienceInviteId ?? null,
        recipientLabel: args.recipientLabel,
        subject: args.subject,
        body: args.body,
        readByRoles: "{}",
        createdAt: now(),
      })
      .run();
  }

  // Build email-style content for an invite send (rfq_sent), then fan out per-audience
  // copies. Audience copies differ:
  //  • admin/buyer/commercial copy may reference price visibility and recipient scope.
  //  • factory copy excludes price and admin-only document references.
  //  • subcontractor portal copy excludes admin docs / recommendations entirely.
  private async notifyRfqSent(rfqId: number, inviteId: number) {
    const invite = db.select().from(rfqInvites).where(eq(rfqInvites.id, inviteId)).get();
    if (!invite) return;
    const rfq = db.select().from(rfqs).where(eq(rfqs.id, rfqId)).get();
    if (!rfq) return;
    const requestingCompany = db.select().from(companies).where(eq(companies.id, rfq.requestingCompanyId)).get();
    const subcontractor = invite.subcontractorId && invite.subcontractorId > 0
      ? (()=>{const r=db.select().from(subcontractors).where(eq(subcontractors.id, invite.subcontractorId)).get(); return r ? hydrateSubcontractor(r) : null;})()
      : null;
    const factory = invite.factoryId ? db.select().from(factories).where(eq(factories.id, invite.factoryId)).get() : null;
    const company = invite.companyId ? db.select().from(companies).where(eq(companies.id, invite.companyId)).get() : null;
    const recipientName = inviteRecipientLabel(invite, subcontractor, factory, company);

    const isExternal = invite.recipientType === "external_subcontractor";
    const dueLine = `Response due: ${rfq.responseDue} · Target ETD: ${rfq.targetEtd}`;
    const scopeLine = `${rfq.quantity} ${rfq.unit} · ${rfq.packageName}`;
    const categoryKey = ((rfq as Rfq & { category?: string }).category ?? "manufacturing_subcontractor") as RfqCategory;
    const isManufacturingCategory = categoryKey === "manufacturing_subcontractor";
    const categoryLabel = (
      (
        {
          manufacturing_subcontractor: "Manufacturing Subcontractor",
          wooden_pallets: "Wooden Pallets",
          polythene_bags: "Polythene Bags",
          cardboard: "Cardboard / Cartons",
          packaging_materials: "Packaging Materials",
          logistics_shipping: "Logistics / Shipping",
          other_supplies: "Other Suppliers",
        } as Record<string, string>
      )[categoryKey] ?? "Manufacturing Subcontractor"
    );
    const sectionLine = `Section: ${categoryLabel}`;
    const workflow = ((rfq as Rfq & { workflowType?: string }).workflowType ?? "standard_rfq") as string;
    const validityMonths = (rfq as Rfq & { priceValidityMonths?: number | null }).priceValidityMonths ?? null;
    const specsRaw = (rfq as Rfq & { materialSpecs?: string | null }).materialSpecs ?? "{}";
    const polybagSpecs = (() => {
      try {
        const obj = JSON.parse(specsRaw) as { bagSize?: string; gauge?: string; etdRequired?: string };
        if (obj && obj.bagSize && obj.gauge && obj.etdRequired) return obj as { bagSize: string; gauge: string; etdRequired: string };
      } catch {}
      return null;
    })();
    const workflowLine =
      workflow === "price_validity_inquiry"
        ? `Workflow: ${validityMonths ?? 6}-month price-validity inquiry — PO issued later when required.`
        : workflow === "polybag_rfq"
          ? `Workflow: Polythene bag inquiry — ${polybagSpecs ? `${polybagSpecs.bagSize}, gauge ${polybagSpecs.gauge}, ETD required ${polybagSpecs.etdRequired}` : "specs on RFQ"}.`
          : null;

    // Product summary line(s) for manufacturing RFQs. Multi-product RFQs are summarized
    // one product per line; single-product / legacy rows fall back to the old line.
    const productLinesSummary = (() => {
      if (!isManufacturingCategory) return null;
      const labels: Record<string, string> = {
        growbags: "Growbags",
        grow_pots: "Grow pots",
        bales_blocks: "Bales / Blocks",
        baggers: "Baggers",
      };
      try {
        const obj = JSON.parse(specsRaw) as {
          productLines?: Array<{
            productType: string;
            productSize?: string;
            quantity?: string;
            loadabilityPerContainer?: string;
            productionSplits?: Array<{ locationName: string; allocation: string }>;
          }>;
          manufacturing?: { productType?: string };
        };
        const lines = Array.isArray(obj?.productLines) ? obj.productLines : [];
        if (lines.length > 0) {
          const rows = lines
            .slice(0, 6)
            .map((l, idx) => {
              const ptLabel = labels[l.productType] ?? l.productType ?? "product";
              const size = l.productSize ?? "";
              const qty = l.quantity ?? "";
              const ldb = l.loadabilityPerContainer ?? "";
              const splits = Array.isArray(l.productionSplits) ? l.productionSplits.filter((s) => s && s.locationName && s.allocation) : [];
              const splitTail = splits.length >= 2
                ? ` — split across ${splits.length} locations: ${splits.map((s) => `${s.locationName} (${s.allocation})`).join(", ")}`
                : "";
              return `  ${idx + 1}. ${ptLabel} · ${size} · ${qty} (${ldb}/container)${splitTail}`;
            })
            .join("\n");
          const more = lines.length > 6 ? `\n  …and ${lines.length - 6} more` : "";
          return `Products in this RFQ (${lines.length}):\n${rows}${more}`;
        }
        const pt = obj?.manufacturing?.productType;
        if (pt) return `Product type: ${labels[pt] ?? pt}.`;
      } catch {}
      return null;
    })();
    // Legacy RFQ-level split notice. Per-line splits are summarized above inside
    // productLinesSummary; this banner only fires for older rows that still carry an
    // RFQ-level productionSplits array (no per-line splits).
    const splitLine = (() => {
      if (!isManufacturingCategory) return null;
      try {
        const obj = JSON.parse(specsRaw) as {
          productionSplits?: Array<{ locationName: string; allocation: string }>;
          productLines?: Array<{ productionSplits?: unknown }>;
        };
        const lineSplits = Array.isArray(obj?.productLines)
          ? obj.productLines.some(
              (l) =>
                Array.isArray(l?.productionSplits) &&
                (l!.productionSplits as Array<{ locationName?: string; allocation?: string }>).filter(
                  (s) => s && s.locationName && s.allocation,
                ).length >= 2,
            )
          : false;
        if (lineSplits) return null;
        const splits = obj?.productionSplits;
        if (!Array.isArray(splits) || splits.length < 2) return null;
        const summary = splits.map((s) => `${s.locationName} (${s.allocation})`).join(", ");
        return `Legacy RFQ-level production split across ${splits.length} locations: ${summary}.`;
      } catch {
        return null;
      }
    })();

    // Admin / buyer / commercial copy.
    const adminSubject = `[RFQ ${rfq.reference}] Invite sent to ${recipientName}`;
    const adminBody = [
      `Hi team,`,
      ``,
      `${requestingCompany?.name ?? "TEG"} has issued an RFQ invite for ${rfq.projectName}.`,
      sectionLine,
      ...(workflowLine ? [workflowLine] : []),
      ...(productLinesSummary ? [productLinesSummary] : []),
      ...(splitLine ? [splitLine] : []),
      `Recipient: ${recipientName} (${
        isExternal
          ? isManufacturingCategory
            ? "external manufacturing subcontractor"
            : `external supplier — ${categoryLabel}`
          : invite.recipientType === "internal_factory"
            ? "internal factory — ETD only"
            : "internal company — ETD only"
      }).`,
      `Scope: ${scopeLine}.`,
      `Price visibility: ${invite.priceVisibility} · Negotiation: ${invite.negotiationScope}.`,
      dueLine,
      ``,
      `Track responses in the RFQ register.`,
    ].join("\n");

    this.insertNotification({
      rfqId,
      inviteId,
      notificationType: "rfq_sent",
      audience: "admin_buyer_commercial",
      audienceCompanyId: rfq.requestingCompanyId,
      recipientLabel: "TEG senior mgmt / commercial",
      subject: adminSubject,
      body: adminBody,
    });

    // Recipient-side copy.
    if (isExternal && subcontractor) {
      // External subcontractor / supplier portal-only copy. No admin documents, no internal cluster context.
      const subSubject = isManufacturingCategory
        ? `New RFQ ${rfq.reference} from ${requestingCompany?.name ?? "TEG"}`
        : `New ${categoryLabel} supplier RFQ ${rfq.reference} from ${requestingCompany?.name ?? "TEG"}`;
      const subBody = [
        `Hello ${subcontractor.contactName ?? subcontractor.name},`,
        ``,
        `${requestingCompany?.name ?? "TEG"} has invited you to quote on ${rfq.projectName}.`,
        sectionLine,
        ...(workflowLine ? [workflowLine] : []),
        ...(productLinesSummary ? [productLinesSummary] : []),
        ...(splitLine ? [splitLine] : []),
        `Package: ${rfq.packageName}.`,
        `Scope: ${scopeLine}.`,
        dueLine,
        ``,
        workflow === "price_validity_inquiry"
          ? `Open your tokenized portal link and submit a unit price (USD) that will remain valid for ${validityMonths ?? 6} months. TEG will issue purchase orders later as quantities are required — you are NOT being asked to ship a single order yet.`
          : workflow === "polybag_rfq"
            ? `Open your tokenized portal link to quote on this polythene bag inquiry. Specs: ${polybagSpecs ? `${polybagSpecs.bagSize}, gauge ${polybagSpecs.gauge}, ETD required ${polybagSpecs.etdRequired}` : "see RFQ"}. Submit unit price (USD) and the earliest delivery date you can commit to.`
            : isManufacturingCategory
              ? `Open your tokenized portal link to submit price + ETD. No internal TEG documents are included with this invite.`
              : `Open your tokenized portal link to submit your unit price (USD) and earliest delivery date for the materials listed above. No internal TEG documents are included with this invite.`,
      ].join("\n");
      this.insertNotification({
        rfqId,
        inviteId,
        notificationType: "rfq_sent",
        audience: "subcontractor_invite",
        audienceInviteId: inviteId,
        recipientLabel: subcontractor.name,
        subject: subSubject,
        body: subBody,
      });
    } else if (invite.recipientType === "internal_factory" && factory) {
      // Factory user copy — ETD only, never includes price.
      const factSubject = `New ETD-only request ${rfq.reference} for ${factory.name}`;
      const factBody = [
        `Hello ${factory.name},`,
        ``,
        `${requestingCompany?.name ?? "TEG"} has assigned an internal ETD request to your factory.`,
        ...(productLinesSummary ? [productLinesSummary] : []),
        ...(splitLine ? [splitLine] : []),
        `Package: ${rfq.packageName}.`,
        `Scope: ${scopeLine}.`,
        dueLine,
        ``,
        `Confirm or revise the earliest dispatch date in the dashboard. Pricing is not part of this thread.`,
      ].join("\n");
      this.insertNotification({
        rfqId,
        inviteId,
        notificationType: "rfq_sent",
        audience: "factory",
        audienceFactoryId: invite.factoryId,
        recipientLabel: factory.name,
        subject: factSubject,
        body: factBody,
      });
    } else if (invite.recipientType === "internal_company" && company) {
      // Intercompany internal recipient — still ETD only.
      const factSubject = `New intercompany request ${rfq.reference} for ${company.name}`;
      const factBody = [
        `Hello ${company.name} team,`,
        ``,
        `${requestingCompany?.name ?? "TEG"} has issued an internal ETD-only request to your cluster.`,
        ...(productLinesSummary ? [productLinesSummary] : []),
        ...(splitLine ? [splitLine] : []),
        `Package: ${rfq.packageName}.`,
        `Scope: ${scopeLine}.`,
        dueLine,
      ].join("\n");
      this.insertNotification({
        rfqId,
        inviteId,
        notificationType: "rfq_sent",
        audience: "factory",
        audienceCompanyId: invite.companyId ?? null,
        recipientLabel: company.name,
        subject: factSubject,
        body: factBody,
      });
    }
  }

  // Build copies for an inbound quote / counter / ETD response.
  private async notifyQuoteReceived(args: {
    inviteId: number;
    actor: InsertNegotiation["actor"];
    action: InsertNegotiation["action"];
    price: number | null | undefined;
    etd: string | null | undefined;
    note: string;
  }) {
    if (args.actor !== "subcontractor" && args.actor !== "factory") return;
    if (args.action !== "quote" && args.action !== "counter") return;
    const invite = db.select().from(rfqInvites).where(eq(rfqInvites.id, args.inviteId)).get();
    if (!invite) return;
    const rfq = db.select().from(rfqs).where(eq(rfqs.id, invite.rfqId)).get();
    if (!rfq) return;
    const subcontractor = invite.subcontractorId && invite.subcontractorId > 0
      ? (()=>{const r=db.select().from(subcontractors).where(eq(subcontractors.id, invite.subcontractorId)).get(); return r ? hydrateSubcontractor(r) : null;})()
      : null;
    const factory = invite.factoryId ? db.select().from(factories).where(eq(factories.id, invite.factoryId)).get() : null;
    const company = invite.companyId ? db.select().from(companies).where(eq(companies.id, invite.companyId)).get() : null;
    const recipientName = inviteRecipientLabel(invite, subcontractor, factory, company);

    // Admin/buyer/commercial copy: include price summary if invite has price visibility on.
    const priceLine = invite.priceVisibility === "visible" && args.price ? `Price: ${formatUSD(args.price)}` : "Price: not applicable (ETD-only thread)";
    const etdLine = args.etd ? `ETD: ${args.etd}` : invite.currentEtd ? `ETD: ${invite.currentEtd}` : "ETD: not yet specified";
    const adminSubject = `[RFQ ${rfq.reference}] ${args.action === "quote" ? "Quote" : "Counter"} received from ${recipientName}`;
    const adminBody = [
      `Hi team,`,
      ``,
      `${recipientName} has submitted a ${args.action} on ${rfq.reference} (${rfq.packageName}).`,
      priceLine,
      etdLine,
      `Note: ${args.note}`,
      ``,
      `Open the RFQ to review the negotiation thread and decide next steps.`,
    ].join("\n");
    this.insertNotification({
      rfqId: invite.rfqId,
      inviteId: invite.id,
      notificationType: "quote_received",
      audience: "admin_buyer_commercial",
      audienceCompanyId: rfq.requestingCompanyId,
      recipientLabel: "TEG senior mgmt / commercial",
      subject: adminSubject,
      body: adminBody,
    });

    // No factory or subcontractor outbound copy here — the responder already knows what they sent.
  }

  // Build a recommendation_pending notification for group_admin only.
  private async notifyRecommendationPending(rec: AwardRecommendation) {
    const invite = db.select().from(rfqInvites).where(eq(rfqInvites.id, rec.inviteId)).get();
    const rfq = db.select().from(rfqs).where(eq(rfqs.id, rec.rfqId)).get();
    if (!invite || !rfq) return;
    const subcontractor = invite.subcontractorId && invite.subcontractorId > 0
      ? (()=>{const r=db.select().from(subcontractors).where(eq(subcontractors.id, invite.subcontractorId)).get(); return r ? hydrateSubcontractor(r) : null;})()
      : null;
    const factory = invite.factoryId ? db.select().from(factories).where(eq(factories.id, invite.factoryId)).get() : null;
    const company = invite.companyId ? db.select().from(companies).where(eq(companies.id, invite.companyId)).get() : null;
    const recipientName = inviteRecipientLabel(invite, subcontractor, factory, company);

    const priceLine = invite.priceVisibility === "visible" && invite.currentPrice
      ? `Recommended price: ${formatUSD(invite.currentPrice)}`
      : `Recommended price: not applicable (ETD-only thread)`;
    const etdLine = invite.currentEtd ? `Recommended ETD: ${invite.currentEtd}` : `Recommended ETD: pending`;
    const closure = rec.proposedClosureReason ? `Proposed closure reason for non-winners: ${rec.proposedClosureReason}` : `Default closure reason will apply to non-winners.`;
    const submittedBy = rec.recommendedBy ? rec.recommendedBy : "Commercial staff";

    const subject = `[RFQ ${rfq.reference}] Award recommendation awaiting your approval`;
    const body = [
      `Hi TEG admin,`,
      ``,
      `${submittedBy} has submitted an award recommendation on ${rfq.reference} (${rfq.packageName}).`,
      `Recommended recipient: ${recipientName}.`,
      priceLine,
      etdLine,
      ``,
      `Rationale: ${rec.rationale}`,
      closure,
      ``,
      `Open the RFQ to approve, reject, or return the recommendation. (Purchase Order and Pricing Quotation references are not attached to this notification.)`,
    ].join("\n");
    this.insertNotification({
      rfqId: rec.rfqId,
      inviteId: rec.inviteId,
      recommendationId: rec.id,
      notificationType: "recommendation_pending",
      audience: "admin_internal",
      recipientLabel: "TEG admin",
      subject,
      body,
    });
  }

  // Build award_approved notifications for the winner + admin/buyer/commercial.
  // Also generates closure notices to non-winning recipients.
  private async notifyAwardApproved(rfqId: number, winnerInviteId: number, closureReason: string) {
    const rfq = db.select().from(rfqs).where(eq(rfqs.id, rfqId)).get();
    if (!rfq) return;
    const winnerInvite = db.select().from(rfqInvites).where(eq(rfqInvites.id, winnerInviteId)).get();
    if (!winnerInvite) return;
    const subcontractor = winnerInvite.subcontractorId && winnerInvite.subcontractorId > 0
      ? (()=>{const r=db.select().from(subcontractors).where(eq(subcontractors.id, winnerInvite.subcontractorId)).get(); return r ? hydrateSubcontractor(r) : null;})()
      : null;
    const factory = winnerInvite.factoryId ? db.select().from(factories).where(eq(factories.id, winnerInvite.factoryId)).get() : null;
    const company = winnerInvite.companyId ? db.select().from(companies).where(eq(companies.id, winnerInvite.companyId)).get() : null;
    const recipientName = inviteRecipientLabel(winnerInvite, subcontractor, factory, company);

    // Admin / buyer / commercial copy.
    const adminPrice = winnerInvite.priceVisibility === "visible" && winnerInvite.currentPrice
      ? `Final price: ${formatUSD(winnerInvite.currentPrice)}`
      : `Final price: not applicable (ETD-only thread)`;
    const adminEtd = winnerInvite.currentEtd ? `Final ETD: ${winnerInvite.currentEtd}` : `Final ETD: pending`;
    const adminSubject = `[RFQ ${rfq.reference}] Awarded to ${recipientName}`;
    const adminBody = [
      `Hi team,`,
      ``,
      `RFQ ${rfq.reference} (${rfq.packageName}) has been awarded to ${recipientName}.`,
      adminPrice,
      adminEtd,
      ``,
      `Closure reason for non-winners: ${closureReason}`,
    ].join("\n");
    this.insertNotification({
      rfqId,
      inviteId: winnerInviteId,
      notificationType: "award_approved",
      audience: "admin_buyer_commercial",
      audienceCompanyId: rfq.requestingCompanyId,
      recipientLabel: "TEG senior mgmt / commercial",
      subject: adminSubject,
      body: adminBody,
    });

    // Winner-side copy.
    if (winnerInvite.recipientType === "external_subcontractor" && subcontractor) {
      const subSubject = `Awarded — RFQ ${rfq.reference}`;
      const subBody = [
        `Hello ${subcontractor.contactName ?? subcontractor.name},`,
        ``,
        `Congratulations — your quotation on ${rfq.reference} (${rfq.packageName}) has been accepted and awarded.`,
        winnerInvite.currentPrice ? `Confirmed price: ${formatUSD(winnerInvite.currentPrice)}.` : `Final price will be confirmed in your portal.`,
        winnerInvite.currentEtd ? `Confirmed ETD: ${winnerInvite.currentEtd}.` : ``,
        ``,
        `Next steps: please confirm acceptance in your portal. TEG will follow up with formal documentation outside this notification thread.`,
      ].filter(Boolean).join("\n");
      this.insertNotification({
        rfqId,
        inviteId: winnerInviteId,
        notificationType: "award_approved",
        audience: "subcontractor_invite",
        audienceInviteId: winnerInviteId,
        recipientLabel: subcontractor.name,
        subject: subSubject,
        body: subBody,
      });
    } else if (winnerInvite.recipientType === "internal_factory" && factory) {
      const factSubject = `Awarded — RFQ ${rfq.reference} (${factory.name})`;
      const factBody = [
        `Hello ${factory.name},`,
        ``,
        `RFQ ${rfq.reference} (${rfq.packageName}) has been awarded to your factory.`,
        winnerInvite.currentEtd ? `Confirmed ETD: ${winnerInvite.currentEtd}.` : ``,
        ``,
        `Next steps: prepare for the dispatch slot. Pricing is handled outside this thread.`,
      ].filter(Boolean).join("\n");
      this.insertNotification({
        rfqId,
        inviteId: winnerInviteId,
        notificationType: "award_approved",
        audience: "factory",
        audienceFactoryId: winnerInvite.factoryId,
        recipientLabel: factory.name,
        subject: factSubject,
        body: factBody,
      });
    } else if (winnerInvite.recipientType === "internal_company" && company) {
      const factSubject = `Awarded — RFQ ${rfq.reference} (${company.name})`;
      const factBody = [
        `Hello ${company.name} team,`,
        ``,
        `RFQ ${rfq.reference} (${rfq.packageName}) has been awarded to your cluster.`,
        winnerInvite.currentEtd ? `Confirmed ETD: ${winnerInvite.currentEtd}.` : ``,
      ].filter(Boolean).join("\n");
      this.insertNotification({
        rfqId,
        inviteId: winnerInviteId,
        notificationType: "award_approved",
        audience: "factory",
        audienceCompanyId: winnerInvite.companyId,
        recipientLabel: company.name,
        subject: factSubject,
        body: factBody,
      });
    }

    // Closure notices for non-winners.
    const others = db
      .select()
      .from(rfqInvites)
      .where(and(eq(rfqInvites.rfqId, rfqId), ne(rfqInvites.id, winnerInviteId)))
      .all();
    for (const other of others) {
      const subc = other.subcontractorId && other.subcontractorId > 0
        ? (()=>{const r=db.select().from(subcontractors).where(eq(subcontractors.id, other.subcontractorId)).get(); return r ? hydrateSubcontractor(r) : null;})()
        : null;
      const fact = other.factoryId ? db.select().from(factories).where(eq(factories.id, other.factoryId)).get() : null;
      const comp = other.companyId ? db.select().from(companies).where(eq(companies.id, other.companyId)).get() : null;
      const otherName = inviteRecipientLabel(other, subc, fact, comp);

      const subjectLine = `RFQ ${rfq.reference} closed`;
      if (other.recipientType === "external_subcontractor" && subc) {
        const body = [
          `Hello ${subc.contactName ?? subc.name},`,
          ``,
          `Thank you for your quotation on ${rfq.reference} (${rfq.packageName}). The RFQ has been closed.`,
          `Reason: ${closureReason}`,
          ``,
          `We appreciate your effort and will keep you in mind for future opportunities.`,
        ].join("\n");
        this.insertNotification({
          rfqId,
          inviteId: other.id,
          notificationType: "award_closure",
          audience: "subcontractor_invite",
          audienceInviteId: other.id,
          recipientLabel: otherName,
          subject: subjectLine,
          body,
        });
      } else if (other.recipientType === "internal_factory" && fact) {
        const body = [
          `Hello ${fact.name},`,
          ``,
          `RFQ ${rfq.reference} (${rfq.packageName}) has been closed for your factory.`,
          `Reason: ${closureReason}`,
        ].join("\n");
        this.insertNotification({
          rfqId,
          inviteId: other.id,
          notificationType: "award_closure",
          audience: "factory",
          audienceFactoryId: other.factoryId,
          recipientLabel: fact.name,
          subject: subjectLine,
          body,
        });
      } else if (other.recipientType === "internal_company" && comp) {
        const body = [
          `Hello ${comp.name} team,`,
          ``,
          `RFQ ${rfq.reference} (${rfq.packageName}) has been closed for your cluster.`,
          `Reason: ${closureReason}`,
        ].join("\n");
        this.insertNotification({
          rfqId,
          inviteId: other.id,
          notificationType: "award_closure",
          audience: "factory",
          audienceCompanyId: other.companyId,
          recipientLabel: comp.name,
          subject: subjectLine,
          body,
        });
      }
    }
  }

  async listNotificationsForRole(args: {
    role: string;
    scopeId: number | null;
    rfqId?: number;
  }): Promise<Notification[]> {
    const allRows = db.select().from(notifications).all();
    const filtered = allRows.filter((row) => {
      if (args.rfqId && row.rfqId !== args.rfqId) return false;
      // Subcontractor users do not see dashboard notifications — they only get invite-scoped via portal endpoints.
      if (args.role === "subcontractor_user") return false;
      // Senior Management / legacy group admin sees ALL internal-audience notifications
      // (admin_internal + admin_buyer_commercial) plus factory + subcontractor copies
      // for full visibility.
      if (args.role === "senior_management" || args.role === "group_admin") return true;
      // Platform Admin sees the same internal-audience set as Senior Mgmt for support purposes,
      // minus subcontractor / factory copies.
      if (args.role === "platform_admin") {
        return row.audience === "admin_internal" || row.audience === "admin_buyer_commercial";
      }
      // Commercial Manager: cluster-scoped admin_buyer_commercial across the whole cluster.
      if (args.role === "commercial_manager") {
        if (row.audience !== "admin_buyer_commercial") return false;
        if (args.scopeId == null) return true;
        const rfq = db.select().from(rfqs).where(eq(rfqs.id, row.rfqId)).get();
        if (!rfq) return false;
        const cos = db.select().from(companies).all();
        const my = cos.find((c) => c.id === args.scopeId);
        const myCluster = my?.clusterName ?? null;
        const reqCo = cos.find((c) => c.id === rfq.requestingCompanyId);
        const prodCo = rfq.producingCompanyId != null ? cos.find((c) => c.id === rfq.producingCompanyId) : null;
        return (
          (reqCo?.clusterName ?? null) === myCluster ||
          (prodCo?.clusterName ?? null) === myCluster
        );
      }
      // Commercial Staff (and any legacy "buyer" rows that slip through): cluster-scoped
      // admin_buyer_commercial. They never see admin_internal (recommendation reviews).
      if (args.role === "commercial_staff" || args.role === "buyer") {
        if (row.audience !== "admin_buyer_commercial") return false;
        if (args.scopeId == null) return true;
        // Match on requesting company OR producing company of the RFQ.
        const rfq = db.select().from(rfqs).where(eq(rfqs.id, row.rfqId)).get();
        if (!rfq) return false;
        return rfq.requestingCompanyId === args.scopeId || rfq.producingCompanyId === args.scopeId;
      }
      // Factory user: only factory-audience notifications for their factory.
      if (args.role === "factory_user") {
        if (row.audience !== "factory") return false;
        if (args.scopeId == null) return false;
        return row.audienceFactoryId === args.scopeId;
      }
      return false;
    });
    return filtered
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
      .map((row) => hydrateNotification(row, args.role));
  }

  async listNotificationsForInvite(inviteId: number): Promise<Notification[]> {
    const rows = db
      .select()
      .from(notifications)
      .where(and(eq(notifications.audience, "subcontractor_invite"), eq(notifications.audienceInviteId, inviteId)))
      .all();
    return rows
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
      .map((row) => hydrateNotification(row, "subcontractor_user"));
  }

  async markNotificationRead(id: number, role: string): Promise<Notification | undefined> {
    const row = db.select().from(notifications).where(eq(notifications.id, id)).get();
    if (!row) return undefined;
    const map = parseReadByRoles(row.readByRoles);
    map[role] = now();
    db.update(notifications)
      .set({ readByRoles: JSON.stringify(map) })
      .where(eq(notifications.id, id))
      .run();
    const next = db.select().from(notifications).where(eq(notifications.id, id)).get();
    return next ? hydrateNotification(next, role) : undefined;
  }

  async markAllNotificationsRead(args: { role: string; scopeId: number | null }): Promise<number> {
    const visible = await this.listNotificationsForRole({ role: args.role, scopeId: args.scopeId });
    let count = 0;
    for (const note of visible) {
      if (note.isRead) continue;
      await this.markNotificationRead(note.id, args.role);
      count += 1;
    }
    return count;
  }

  async overview() {
    const allRfqs = db.select().from(rfqs).all();
    const invites = db.select().from(rfqInvites).all();

    return {
      totalRfqs: allRfqs.length,
      activeNegotiations: invites.filter((invite) => invite.status === "under_negotiation" || invite.status === "quoted").length,
      acceptedOrders: invites.filter((invite) => invite.status === "accepted").length
        + allRfqs.filter((rfq) => rfq.status === "awarded" && !invites.some((i) => i.rfqId === rfq.id && i.status === "accepted")).length,
      pendingResponses: invites.filter((invite) => invite.status === "sent").length,
      etdOnlyRequests: invites.filter((invite) => invite.negotiationScope === "etd_only").length,
      externalEscalations: allRfqs.filter((rfq) => rfq.status === "external_escalated" || rfq.escalationReason).length,
    };
  }

  private async refreshRfqStatus(rfqId: number) {
    const currentRfq = db.select().from(rfqs).where(eq(rfqs.id, rfqId)).get();
    const invites = db.select().from(rfqInvites).where(eq(rfqInvites.rfqId, rfqId)).all();
    let status = "draft";

    // Once awarded, the RFQ is sticky and never falls back into an active state.
    if (currentRfq?.awardedInviteId) {
      db.update(rfqs).set({ status: "awarded" }).where(eq(rfqs.id, rfqId)).run();
      return;
    }

    if (invites.length) {
      if (currentRfq?.escalationReason) status = "external_escalated";
      else if (invites.some((invite) => invite.status === "accepted")) status = "awarded";
      else if (invites.every((invite) => invite.status === "declined" || invite.status === "closed"))
        status = "declined";
      else if (invites.some((invite) => invite.status === "under_negotiation")) status = "under_negotiation";
      else if (invites.some((invite) => invite.status === "quoted")) status = "quoted";
      else status = "sent";
    }

    db.update(rfqs).set({ status }).where(eq(rfqs.id, rfqId)).run();
  }
}

export const storage = new DatabaseStorage();
