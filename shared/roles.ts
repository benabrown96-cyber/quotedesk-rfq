// Role and permission model for the RFQ system.
// Pragmatic, demo-only — no real auth. Roles travel via request headers.

import type { RfqCategory, VendorType } from "./schema";

// Role registry. The original `group_admin` is kept for back-compat
// (existing seeded users / DB rows). New deployments use `senior_management`
// for business-approval authority and `platform_admin` for IT / platform support.
//
// Note: the legacy "buyer" role has been removed from the visible model —
// its responsibilities now sit with Senior Management (approvals/awards),
// Commercial Manager (cluster oversight, send/negotiate, permissions),
// and Commercial Staff (RFQ creation + granular send/negotiate/recommend).
// Any DB rows or API headers carrying role="buyer" are normalized to
// "commercial_staff" via `normalizeLegacyRole` before they reach perm checks.
export const ROLES = [
  "senior_management",
  "platform_admin",
  "commercial_manager",
  "group_admin", // legacy alias of senior_management — preserved for back-compat
  "commercial_staff",
  "factory_user",
  "subcontractor_user",
] as const;
export type Role = (typeof ROLES)[number];

// Roles that hold business-approval authority (award / reject recommendations,
// access reference docs, final award). `group_admin` is kept here for back-compat
// because earlier seeded users carry that role.
export const BUSINESS_APPROVAL_ROLES = ["senior_management", "group_admin"] as const;
export function isBusinessApprover(role: Role): boolean {
  return (BUSINESS_APPROVAL_ROLES as readonly string[]).includes(role);
}

// Platform / IT support — no business decisions.
export function isPlatformAdmin(role: Role): boolean {
  return role === "platform_admin";
}

export const ROLE_HEADER = "x-rfq-role";
export const SCOPE_HEADER = "x-rfq-scope-id";
export const COMMERCIAL_GRANT_HEADER = "x-rfq-commercial-grant";
export const USER_ID_HEADER = "x-rfq-user-id";


export type RoleContext = {
  role: Role;
  scopeId?: number | null;
  commercialGrant?: boolean;
  canSendRfqs?: boolean;
  canNegotiate?: boolean;
  canRecommendAwards?: boolean;
};

export function resolveCommercialPermissions(input: {
  commercialGrant?: boolean | null;
  canSendRfqs?: boolean | null;
  canNegotiate?: boolean | null;
  canRecommendAwards?: boolean | null;
}): { canSendRfqs: boolean; canNegotiate: boolean; canRecommendAwards: boolean } {
  const granular = {
    canSendRfqs: Boolean(input.canSendRfqs),
    canNegotiate: Boolean(input.canNegotiate),
    canRecommendAwards: Boolean(input.canRecommendAwards),
  };
  const anyGranular = granular.canSendRfqs || granular.canNegotiate || granular.canRecommendAwards;
  if (!anyGranular && input.commercialGrant) {
    return { canSendRfqs: true, canNegotiate: true, canRecommendAwards: true };
  }
  return granular;
}

export type RolePersona = {
  role: Role;
  label: string;
  shortLabel: string;
  description: string;
  permissionsSummary: string[];
  defaultScopeId?: number;
  scopeKind?: "company" | "factory" | "none" | "cluster";
};

export const ROLE_PERSONAS: RolePersona[] = [
  {
    role: "senior_management",
    label: "Senior Management",
    shortLabel: "Senior Mgmt",
    description:
      "Final business authority across TEG. Approves award recommendations, awards directly when needed, and accesses commercial reference documents.",
    permissionsSummary: [
      "See all clusters, RFQs, invites, recommendations, and audit history",
      "Approve / reject / return award recommendations and finalise awards",
      "Open Purchase Order and Pricing Quotation reference documents",
      "Manage system settings and user access",
    ],
    scopeKind: "none",
  },
  {
    role: "platform_admin",
    label: "Platform Admin / IT Support",
    shortLabel: "Platform Admin",
    description:
      "IT / platform support. Can manage users, fix portal tokens, and change system settings — but never approves awards or accesses commercial reference documents.",
    permissionsSummary: [
      "Manage users (active state, role assignment, granular grants)",
      "Revoke / extend portal tokens and view audit history",
      "Edit system settings (response window, day mode)",
      "No award approvals, no PO / Pricing Quotation access, no direct awards",
    ],
    scopeKind: "none",
  },
  {
    role: "commercial_manager",
    label: "Commercial Manager (cluster)",
    shortLabel: "Commercial Mgr",
    description:
      "Optional cluster oversight role. Sees all RFQs and recommendations in the assigned cluster; can grant commercial-staff permissions; never finalises an award.",
    permissionsSummary: [
      "Cluster-scoped: oversees commercial staff in the assigned cluster",
      "Can create / open RFQs, send invites, and negotiate within the cluster",
      "Can grant or revoke commercial-staff permissions in the cluster",
      "Cannot approve / reject award recommendations or finalise an award",
    ],
    scopeKind: "company",
  },
  {
    role: "group_admin",
    label: "Group admin (legacy — Senior Management)",
    shortLabel: "Senior Mgmt",
    description: "Legacy alias for Senior Management. New deployments should use senior_management.",
    permissionsSummary: [
      "Same authority as Senior Management",
      "Kept only for back-compat with previously seeded data",
    ],
    scopeKind: "none",
  },
  {
    role: "commercial_staff",
    label: "Commercial Staff (cluster)",
    shortLabel: "Commercial",
    description:
      "Primary RFQ creators for their cluster. Sending invites, negotiating, and submitting award recommendations require explicit grants. Cannot accept, decline, or award.",
    permissionsSummary: [
      "Cluster-scoped: only acts for their assigned cluster company",
      "Creates / opens RFQs by default — no grant required",
      "Sends invites and counters / messages only when granted",
      "Submits award recommendations to Senior Management when granted",
      "Never accepts, declines, or awards an RFQ",
      "Hidden from Purchase Order / Pricing Quotation reference docs",
    ],
    defaultScopeId: 1,
    scopeKind: "company",
  },
  {
    role: "factory_user",
    label: "Factory User",
    shortLabel: "Factory user",
    description: "Internal factory operator who only sees ETD-only assignments for their factory.",
    permissionsSummary: [
      "Sees only assigned internal ETD invites for their factory",
      "Submit / revise ETD, accept, or decline — never price",
      "Closed (non-winning) requests drop out of the active queue",
      "Cannot create RFQs or escalate outside",
    ],
    defaultScopeId: 2,
    scopeKind: "factory",
  },
  {
    role: "subcontractor_user",
    label: "Subcontractor (vendor dashboard + portal)",
    shortLabel: "Vendor",
    description:
      "External vendor / subcontractor. Signs in to a restricted vendor dashboard that lists their assigned RFQs, and continues to use tokenized portal links to submit price + ETD on each invite.",
    permissionsSummary: [
      "Restricted vendor dashboard — only their own assigned RFQs / invites",
      "Per-invite tokenized portal link is still the response experience",
      "Cannot see other vendors, internal documents, comparisons, recommendations, or settings",
    ],
    scopeKind: "none",
  },
];

export type PermCtx = {
  commercialGrant?: boolean;
  canSendRfqs?: boolean;
  canNegotiate?: boolean;
  canRecommendAwards?: boolean;
};

function asPermCtx(input: boolean | PermCtx | undefined): {
  canSendRfqs: boolean;
  canNegotiate: boolean;
  canRecommendAwards: boolean;
} {
  if (typeof input === "boolean") {
    return resolveCommercialPermissions({ commercialGrant: input });
  }
  return resolveCommercialPermissions(input ?? {});
}

export const RolePerms = {
  // Demo update: subcontractor / vendor users now reach an authenticated, restricted
  // vendor dashboard (see VendorDashboard) instead of being blocked. They still cannot
  // see internal commercial data — the API and UI both restrict them. Token portal
  // links remain the canonical external response experience.
  canViewDashboard: (_role: Role) => true,
  // Open / create RFQs: senior management, platform admin (for testing/setup), commercial manager,
  // commercial staff. Platform admin can create but their RFQs are still routed by their (none) scope.
  canCreateRfq: (role: Role, _ctx?: boolean | PermCtx) =>
    isBusinessApprover(role) ||
    role === "commercial_manager" ||
    role === "commercial_staff",
  canManageSubcontractors: (role: Role) =>
    isBusinessApprover(role) || role === "commercial_manager",
  // Editing the cluster availability of a subcontractor — Senior Management or Platform Admin.
  canEditSubcontractorClusterAccess: (role: Role) =>
    isBusinessApprover(role) || isPlatformAdmin(role),
  canSendInvite: (role: Role, ctx?: boolean | PermCtx) => {
    if (isBusinessApprover(role) || role === "commercial_manager") return true;
    if (role !== "commercial_staff") return false;
    return asPermCtx(ctx).canSendRfqs;
  },
  canEscalate: (role: Role, ctx?: boolean | PermCtx) => {
    if (isBusinessApprover(role) || role === "commercial_manager") return true;
    if (role !== "commercial_staff") return false;
    return asPermCtx(ctx).canSendRfqs;
  },
  // "Buyer-side" negotiate authority — kept the function name for back-compat
  // since many call sites still call canBuyerNegotiate. Now resolves to:
  // Senior Management or Commercial Manager unconditionally; Commercial Staff
  // when their canNegotiate grant is on.
  canBuyerNegotiate: (role: Role, ctx?: boolean | PermCtx) => {
    if (isBusinessApprover(role) || role === "commercial_manager") return true;
    if (role !== "commercial_staff") return false;
    return asPermCtx(ctx).canNegotiate;
  },
  // Final award authority — Senior Management ONLY (the previous "buyer" role
  // is retired; its award authority now sits with Senior Management).
  // Platform Admin and Commercial Manager explicitly cannot finalise an award.
  canAcceptOrAward: (role: Role) => isBusinessApprover(role),
  canSubmitAwardRecommendation: (role: Role, ctx?: boolean | PermCtx) => {
    if (role !== "commercial_staff") return false;
    return asPermCtx(ctx).canRecommendAwards;
  },
  // Approve / reject / return recommendations — Senior Management only.
  canDecideAwardRecommendation: (role: Role) => isBusinessApprover(role),
  canViewAwardRecommendations: (role: Role) =>
    isBusinessApprover(role) ||
    role === "commercial_staff" ||
    role === "commercial_manager",
  canSwitchCompany: (role: Role) => isBusinessApprover(role),
  canFactoryRespond: (role: Role) => role === "factory_user",
  isClusterScoped: (role: Role) =>
    role === "commercial_staff" || role === "commercial_manager",
  // Audit trail visibility — business approvers + platform admin see full trail; cluster roles see RFQ-scoped.
  canViewAuditTrail: (role: Role) => isBusinessApprover(role) || isPlatformAdmin(role),
  canViewRfqAuditTrail: (role: Role) =>
    isBusinessApprover(role) ||
    isPlatformAdmin(role) ||
    role === "commercial_staff" ||
    role === "commercial_manager",
  // Token controls (revoke / extend) — Senior Management or Platform Admin.
  canManageInviteTokens: (role: Role) => isBusinessApprover(role) || isPlatformAdmin(role),
  // Reference document access (PO + Pricing Quotation) — Senior Management ONLY.
  // Platform Admin is explicitly excluded so IT support can fix issues without seeing
  // commercial documents. Commercial / factory / subcontractor are also excluded.
  canViewReferenceDocuments: (role: Role) => isBusinessApprover(role),
  // Reference document upload (PO + Pricing Quotation). Mirrors RFQ creator authority
  // so Commercial Staff / Commercial Manager can attach the source PO and pricing
  // quote during the create flow. Visibility (list / download) remains Senior
  // Management only via canViewReferenceDocuments — uploaders cannot read back what
  // they just attached, which preserves the existing confidentiality posture.
  canUploadReferenceDocuments: (role: Role, ctx?: boolean | PermCtx) => {
    if (isBusinessApprover(role)) return true;
    if (role === "commercial_manager") return true;
    if (role === "commercial_staff") return asPermCtx(ctx).canSendRfqs || true; // staff can attach docs even without send grant — RFQ creation already allowed
    return false;
  },
  // System settings & user management — Senior Management or Platform Admin.
  canEditSystemSettings: (role: Role) => isBusinessApprover(role) || isPlatformAdmin(role),
  canManageUsers: (role: Role) => isBusinessApprover(role) || isPlatformAdmin(role),
  // Commercial managers can grant cluster-staff permissions within their cluster.
  canManageCommercialPermissions: (role: Role) =>
    isBusinessApprover(role) || isPlatformAdmin(role) || role === "commercial_manager",
  // Role assignment — only Senior Management or Platform Admin can change a user's role.
  canAssignRole: (role: Role) => isBusinessApprover(role) || isPlatformAdmin(role),
  // Editing an existing RFQ. Senior Management always; Commercial Manager / Commercial
  // Staff (with the send-RFQs grant) within their scope; Factory User only for
  // factory-managed pallet RFQs (route enforces category check). Platform Admin is
  // explicitly excluded — they manage users / settings / tokens, not commercial content.
  canEditRfq: (role: Role, ctx?: boolean | PermCtx) => {
    if (isBusinessApprover(role)) return true;
    if (role === "commercial_manager") return true;
    if (role === "commercial_staff") return asPermCtx(ctx).canSendRfqs;
    if (role === "factory_user") return true; // route narrows to pallet RFQs
    return false;
  },
};

export function isValidRole(value: string | undefined | null): value is Role {
  return !!value && (ROLES as readonly string[]).includes(value);
}

// Legacy role normalization — maps retired roles (currently just "buyer") to
// their current equivalents. Buyer responsibilities are split between Senior
// Management (final award), Commercial Manager (cluster oversight), and
// Commercial Staff (RFQ creation + negotiation under grants). For
// back-compatibility with existing DB rows / API headers we map "buyer" to
// "commercial_staff" — that's the closest day-to-day equivalent and keeps
// users active without granting them award authority.
export function normalizeLegacyRole(value: string | undefined | null): string | undefined | null {
  if (value === "buyer") return "commercial_staff";
  return value;
}

// Default automatic closure reason used when an RFQ is awarded to another recipient
// and the prior dashboard owner did not provide a manual reason.
export const DEFAULT_CLOSURE_REASON =
  "Closed automatically because RFQ was awarded to another recipient.";

// Routing rules (Indian subcontractor routing):
// Only Euro Substrates (and TEG group admin operating across the Euro / Growrite cluster)
// may invite Indian subcontractors. Growrite Substrate cannot, because TEG does not
// operate under Growrite Substrate in India.
export const INDIA_ALLOWED_REQUESTING_COMPANY_CODES = ["ESL", "TCL", "PTL"] as const;
export const INDIA_BLOCKED_REQUESTING_COMPANY_CODES = ["GRT"] as const;

export const INDIA_BLOCKED_MESSAGE =
  "Indian subcontractors cannot be invited under Growrite Substrate. Within the Euro / Growrite cluster, only Euro Substrates sends RFQs to Indian subcontractors. Switch the requesting company to Euro Substrates and retry.";

// Subcontractor cluster-availability helper.
// Empty list = available to BOTH clusters. Otherwise must include the requesting cluster.
export function isSubcontractorAvailableForCluster(
  clusterAccess: string[] | undefined | null,
  requestingCluster: string | undefined | null,
): boolean {
  const list = Array.isArray(clusterAccess) ? clusterAccess : [];
  if (list.length === 0) return true;
  if (!requestingCluster) return true;
  return list.includes(requestingCluster);
}

export const SUBCONTRACTOR_CLUSTER_BLOCKED_MESSAGE =
  "This subcontractor is not available to the requesting company's cluster. Update the subcontractor's cluster availability in Senior Management settings, or pick a different recipient.";

// Vendor / RFQ category compatibility helper.
// A vendor with no explicit supportedCategories list is inferred:
//   - manufacturing_subcontractor vendors → [manufacturing_subcontractor]
//   - supplier vendors → [other_supplies]
// Manufacturing-category RFQs may only invite manufacturing-subcontractor vendors;
// material/service-category RFQs may only invite supplier vendors whose supportedCategories include the RFQ category.

export function effectiveSupportedCategories(
  vendorType: VendorType | string | undefined | null,
  supportedCategories: string[] | undefined | null,
): string[] {
  const list = Array.isArray(supportedCategories) ? supportedCategories.filter(Boolean) : [];
  if (list.length > 0) return list;
  if (vendorType === "manufacturing_subcontractor") return ["manufacturing_subcontractor"];
  // Default supplier vendors with no explicit list to other_supplies.
  return ["other_supplies"];
}

export function isVendorAllowedForCategory(
  vendorType: VendorType | string | undefined | null,
  supportedCategories: string[] | undefined | null,
  rfqCategory: RfqCategory | string | undefined | null,
): boolean {
  if (!rfqCategory) return true;
  const isManufacturingRfq = rfqCategory === "manufacturing_subcontractor";
  const isManufacturingVendor = vendorType === "manufacturing_subcontractor";
  // Manufacturing RFQs may only invite manufacturing vendors and vice versa for category alignment.
  if (isManufacturingRfq !== isManufacturingVendor) return false;
  if (isManufacturingRfq) return true;
  return effectiveSupportedCategories(vendorType, supportedCategories).includes(rfqCategory);
}

export const VENDOR_CATEGORY_BLOCKED_MESSAGE =
  "This vendor's supported categories do not match this RFQ's section. Pick a vendor whose category list includes the RFQ section, or update the vendor's supported categories.";
