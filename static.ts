import type { Express, NextFunction, Request, Response } from "express";
import type { Server } from "node:http";
import {
  insertAwardRecommendationSchema,
  insertInviteSchema,
  insertNegotiationSchema,
  insertRfqDocumentSchema,
  insertRfqSchema,
  insertSubcontractorSchema,
  recommendationDecisionSchema,
  updateSettingsSchema,
  updateSubcontractorClusterAccessSchema,
  updateRfqSchema,
  bulkInviteSchema,
  poExtractRequestSchema,
  type PoExtractResult,
} from "@shared/schema";
import { extractPoFields } from "./po-extract";
import {
  ROLE_HEADER,

  SCOPE_HEADER,
  COMMERCIAL_GRANT_HEADER,
  USER_ID_HEADER,
  ROLES,
  RolePerms,
  DEFAULT_CLOSURE_REASON,
  isBusinessApprover,
  isPlatformAdmin,
  isValidRole,
  normalizeLegacyRole,
  isSubcontractorAvailableForCluster,
  isVendorAllowedForCategory,
  resolveCommercialPermissions,
  type Role,
  type PermCtx,
} from "@shared/roles";
import type { User } from "@shared/schema";
import { storage, RfqRoutingError } from "./storage";

function asNumber(value: string | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

type RoleRequest = Request & {
  role: Role;
  scopeId: number | null;
  commercialGrant: boolean;
  canSendRfqs: boolean;
  canNegotiate: boolean;
  canRecommendAwards: boolean;
  userId: number | null;
  user: User | null;
};

function roleCtx(req: Request): {
  role: Role;
  scopeId: number | null;
  commercialGrant: boolean;
  canSendRfqs: boolean;
  canNegotiate: boolean;
  canRecommendAwards: boolean;
  permCtx: PermCtx;
  user: User | null;
} {
  const r = req as unknown as RoleRequest;
  const permCtx: PermCtx = {
    commercialGrant: r.commercialGrant,
    canSendRfqs: r.canSendRfqs,
    canNegotiate: r.canNegotiate,
    canRecommendAwards: r.canRecommendAwards,
  };
  return {
    role: r.role,
    scopeId: r.scopeId,
    commercialGrant: r.commercialGrant,
    canSendRfqs: r.canSendRfqs,
    canNegotiate: r.canNegotiate,
    canRecommendAwards: r.canRecommendAwards,
    permCtx,
    user: r.user,
  };
}

function actorMeta(req: Request) {
  const r = req as unknown as RoleRequest;
  return {
    userId: r.user?.id ?? null,
    role: r.role,
    label: r.user?.name ? `${r.user.name} (${r.role})` : r.role,
  };
}

function readUserId(req: Request): number | null {
  const raw = req.headers[USER_ID_HEADER] as string | undefined;
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function readLegacyRoleContext(req: Request): {
  role: Role;
  scopeId: number | null;
  commercialGrant: boolean;
} {
  const rawHeader = (req.headers[ROLE_HEADER] as string | undefined)?.trim();
  // Normalize legacy roles (e.g. "buyer" → "commercial_staff") before validating.
  const headerRole = normalizeLegacyRole(rawHeader) ?? undefined;
  // Default role when nothing is supplied: senior_management (replaces TEG admin default).
  const role: Role = isValidRole(headerRole) ? headerRole : "senior_management";
  const rawScope = req.headers[SCOPE_HEADER] as string | undefined;
  const scopeId = rawScope ? Number(rawScope) : NaN;
  const grantHeader = (req.headers[COMMERCIAL_GRANT_HEADER] as string | undefined)?.trim();
  const commercialGrant = grantHeader === "1" || grantHeader === "true";
  return {
    role,
    scopeId: Number.isFinite(scopeId) ? scopeId : null,
    commercialGrant,
  };
}

async function attachRole(req: Request, res: Response, next: NextFunction) {
  const userId = readUserId(req);
  let user: User | null = null;
  if (userId) {
    const found = await storage.getUserById(userId);
    if (!found) {
      return res.status(401).json({ message: "Unknown user. Please sign in again." });
    }
    if (!found.active) {
      return res.status(403).json({ message: "Your account is inactive. Contact a Platform Admin." });
    }
    user = found;
  }

  if (user) {
    // Normalize legacy DB rows (e.g. role="buyer") to the current model.
    const normalized = normalizeLegacyRole(user.role) ?? user.role;
    const role = (isValidRole(normalized) ? normalized : "commercial_staff") as Role;
    const granular = resolveCommercialPermissions({
      commercialGrant: user.commercialGrant,
      canSendRfqs: user.canSendRfqs,
      canNegotiate: user.canNegotiate,
      canRecommendAwards: user.canRecommendAwards,
    });
    (req as unknown as RoleRequest).role = role;
    (req as unknown as RoleRequest).scopeId = user.scopeId ?? null;
    (req as unknown as RoleRequest).commercialGrant = Boolean(user.commercialGrant);
    (req as unknown as RoleRequest).canSendRfqs = granular.canSendRfqs;
    (req as unknown as RoleRequest).canNegotiate = granular.canNegotiate;
    (req as unknown as RoleRequest).canRecommendAwards = granular.canRecommendAwards;
    (req as unknown as RoleRequest).userId = user.id;
    (req as unknown as RoleRequest).user = user;
  } else {
    const ctx = readLegacyRoleContext(req);
    (req as unknown as RoleRequest).role = ctx.role;
    (req as unknown as RoleRequest).scopeId = ctx.scopeId;
    (req as unknown as RoleRequest).commercialGrant = ctx.commercialGrant;
    (req as unknown as RoleRequest).canSendRfqs = ctx.commercialGrant;
    (req as unknown as RoleRequest).canNegotiate = ctx.commercialGrant;
    (req as unknown as RoleRequest).canRecommendAwards = ctx.commercialGrant;
    (req as unknown as RoleRequest).userId = null;
    (req as unknown as RoleRequest).user = null;
  }
  next();
}

function deny(res: Response, message: string) {
  return res.status(403).json({ message });
}

// Helper: Product Manufacturing RFQs need both Purchase Order + Pricing Quotation
// attached BEFORE invites can be sent (single + bulk) and BEFORE an award /
// recommendation approval can finalise. Returns null when ok, otherwise an Express
// response was emitted with status 422 + a clear message naming the missing docs.
// The check goes through storage.getDocumentRequirementStatus, which returns only
// boolean presence flags — no filenames, no metadata, safe to call from any route.
async function blockIfMissingRequiredDocs(
  res: Response,
  rfqId: number,
  context: "send" | "bulk-send" | "award" | "recommendation",
): Promise<boolean> {
  const status = await storage.getDocumentRequirementStatus(rfqId);
  if (!status.required || status.satisfied) return false;
  const verb =
    context === "send" || context === "bulk-send"
      ? "sent"
      : context === "award"
        ? "awarded"
        : "approved";
  const noun = context === "recommendation" ? "approve this recommendation" : `be ${verb}`;
  res.status(422).json({
    message: `Product Manufacturing RFQ cannot ${noun} until both the Purchase Order and Pricing Quotation documents are attached. Missing: ${status.missingLabels.join(", ")}.`,
    documentRequirement: status,
  });
  return true;
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // Health check — used by Railway and load balancers
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.use("/api", (req, res, next) => {
    attachRole(req, res, next).catch(next);
  });

  // Subcontractor / vendor users get a restricted authenticated experience.
  // They are NOT allowed to hit internal commercial endpoints (users directory,
  // settings, documents, recommendations, audit, comparisons, amendments,
  // subcontractor master data, factory data, etc.). They CAN hit:
  //   - /api/me                            (their own user profile)
  //   - /api/portal/*                      (token portal stays open as today)
  //   - GET /api/rfqs                      (filtered to their own assigned RFQs)
  //   - GET /api/rfqs/:id                  (filtered to their own invite)
  // Anything else returns 403 with a vendor-friendly message. This middleware
  // runs FIRST (before any /api route handlers are registered) so it covers
  // every endpoint, including /api/users and /api/settings.
  const VENDOR_ALLOWED_PATH_PREFIXES = [
    "/portal/", // token portal — token IS the auth
    "/me", // own profile
  ];
  function isVendorAllowedRequest(req: Request): boolean {
    const path = req.path;
    if (VENDOR_ALLOWED_PATH_PREFIXES.some((p) => path.startsWith(p))) return true;
    if (req.method !== "GET") return false;
    if (path === "/rfqs") return true;
    // /rfqs/:id (numeric) is allowed; subpaths like /rfqs/:id/documents,
    // /rfqs/:id/recommendations, /rfqs/:id/amendments, /rfqs/:id/document-requirements
    // are explicitly NOT allowed.
    if (/^\/rfqs\/\d+$/.test(path)) return true;
    return false;
  }
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    const role = (req as unknown as RoleRequest).role;
    if (role !== "subcontractor_user") return next();
    if (isVendorAllowedRequest(req)) return next();
    return deny(
      res,
      "Vendor users only have access to their own assigned RFQs and the portal response link.",
    );
  });

  app.get("/api/users", async (_req, res) => {
    const all = await storage.listUsers();
    res.json(all);
  });

  app.get("/api/me", async (req, res) => {
    const userId = readUserId(req);
    if (!userId) return res.status(401).json({ message: "Not signed in" });
    const user = await storage.getUserById(userId);
    if (!user) return res.status(401).json({ message: "Unknown user" });
    if (!user.active) return res.status(403).json({ message: "Account inactive" });
    await storage.touchUserLogin(user.id);
    res.json(user);
  });

  app.patch("/api/users/:id", async (req, res) => {
    const { role } = roleCtx(req);
    if (!RolePerms.canManageUsers(role)) {
      return deny(res, "Only Senior Management or Platform Admin can manage user accounts.");
    }
    const id = asNumber(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid user id" });
    const target = await storage.getUserById(id);
    if (!target) return res.status(404).json({ message: "User not found" });

    const actor = actorMeta(req);
    let updated = target;

    // Active toggle.
    if (typeof req.body.active === "boolean" && req.body.active !== Boolean(target.active)) {
      updated = (await storage.setUserActive(id, req.body.active)) ?? updated;
      await storage.logAudit({
        eventType: "user_active_changed",
        actor,
        action: req.body.active ? "activate_user" : "deactivate_user",
        summary: `${target.name} → ${req.body.active ? "active" : "inactive"}`,
        metadata: { targetUserId: id },
      });
    }

    // Role assignment — Senior Management or Platform Admin can change roles.
    if (typeof req.body.role === "string" && req.body.role !== updated.role) {
      // Normalize legacy roles before validation so e.g. an inbound "buyer"
      // assignment is silently mapped to "commercial_staff".
      const next = (normalizeLegacyRole(req.body.role) ?? req.body.role) as string;
      if (!isValidRole(next)) {
        return res.status(422).json({ message: `Unknown role: ${next}` });
      }
      if (!RolePerms.canAssignRole(role)) {
        return deny(res, "Only Senior Management or Platform Admin can change roles.");
      }
      updated = (await storage.setUserRole(id, next)) ?? updated;
      await storage.logAudit({
        eventType: "user_role_changed",
        actor,
        action: "assign_role",
        summary: `${target.name} role → ${next}`,
        metadata: { targetUserId: id, previousRole: target.role, newRole: next },
      });
    }

    // Commercial grant umbrella — only if updated user is now (or was) commercial_staff.
    if (typeof req.body.commercialGrant === "boolean") {
      if (updated.role !== "commercial_staff") {
        return res.status(422).json({
          message: "Commercial grant only applies to commercial_staff accounts.",
        });
      }
      // Commercial Manager can grant within their cluster only.
      if (
        role === "commercial_manager" &&
        updated.companyId !== null &&
        (req as unknown as RoleRequest).scopeId !== updated.companyId
      ) {
        return deny(res, "Commercial Managers can only grant permissions within their own cluster.");
      }
      updated = (await storage.setUserCommercialGrant(id, req.body.commercialGrant)) ?? updated;
      await storage.logAudit({
        eventType: "user_grant_changed",
        actor,
        action: "toggle_commercial_grant",
        summary: `${target.name} commercial grant → ${req.body.commercialGrant ? "granted" : "revoked"}`,
        metadata: { targetUserId: id, granted: req.body.commercialGrant },
      });
    }

    for (const field of ["canSendRfqs", "canNegotiate", "canRecommendAwards"] as const) {
      if (typeof req.body[field] === "boolean") {
        if (updated.role !== "commercial_staff") {
          return res.status(422).json({
            message: "Granular commercial permissions only apply to commercial_staff accounts.",
          });
        }
        if (
          role === "commercial_manager" &&
          updated.companyId !== null &&
          (req as unknown as RoleRequest).scopeId !== updated.companyId
        ) {
          return deny(res, "Commercial Managers can only grant permissions within their own cluster.");
        }
        updated = (await storage.setUserPermission(id, field, req.body[field])) ?? updated;
        await storage.logAudit({
          eventType: "user_grant_changed",
          actor,
          action: `toggle_${field}`,
          summary: `${target.name} ${field} → ${req.body[field] ? "granted" : "revoked"}`,
          metadata: { targetUserId: id, field, value: req.body[field] },
        });
      }
    }
    res.json(updated);
  });

  // ---------- System settings ----------
  app.get("/api/settings", async (_req, res) => {
    res.json(await storage.getSettings());
  });

  app.patch("/api/settings", async (req, res) => {
    const { role } = roleCtx(req);
    if (!RolePerms.canEditSystemSettings(role)) {
      return deny(res, "Only Senior Management or Platform Admin can change system settings.");
    }
    const parsed = updateSettingsSchema.parse(req.body);
    const actor = actorMeta(req);
    const updated = await storage.updateSettings(parsed, actor.label);
    await storage.logAudit({
      eventType: "settings_changed",
      actor,
      action: "update_settings",
      summary: `System settings updated: ${Object.keys(parsed).join(", ")}`,
      metadata: { ...parsed },
    });
    res.json(updated);
  });

  // (vendor allow-list middleware moved above; previous block now removed)

  app.get("/api/overview", async (_req, res) => {
    res.json(await storage.overview());
  });

  app.get("/api/companies", async (_req, res) => {
    res.json(await storage.listCompanies());
  });

  app.get("/api/factories", async (_req, res) => {
    res.json(await storage.listFactories());
  });

  // Partner / Client master data — used by the Product Manufacturing create form.
  // The client may pass ?cluster=... to filter the list to one cluster's partners; the
  // create form sets this from the selected requesting company's clusterName so users
  // see only partners that do business with that side. Senior Management / Platform
  // Admin can call without a filter to see the full list.
  app.get("/api/partner-clients", async (req, res) => {
    const cluster = typeof req.query.cluster === "string" && req.query.cluster.trim()
      ? req.query.cluster.trim()
      : null;
    const list = await storage.listPartnerClients({ clusterName: cluster });
    res.json(list);
  });

  // PO extraction assist. Accepts an uploaded PO file (text/csv/PDF) and returns
  // best-effort heuristic extraction of Partner / Client, Country, and PO Customer.
  // The endpoint is advisory only — the create-RFQ form lets the user edit/confirm
  // before the RFQ is created. The uploaded file is NOT persisted and is never sent
  // to factories or vendors. Image / scanned PDFs without embedded text are rejected
  // with a clear note so the user knows OCR integration is required.
  app.post("/api/po-extract", async (req, res) => {
    const { role, permCtx } = roleCtx(req);
    if (!RolePerms.canCreateRfq(role, permCtx)) {
      return deny(res, "Only Commercial Staff, Commercial Managers, and Senior Management can use PO extraction.");
    }
    const parsed = poExtractRequestSchema.parse(req.body);
    let result: PoExtractResult;
    try {
      result = await extractPoFields(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : "PO extraction failed.";
      return res.status(422).json({ message });
    }
    res.json(result);
  });

  // List subcontractors / suppliers. Returns full records so the client can present
  // availability + category badges. Cluster-scoped roles see only those subcontractors
  // that are available to their cluster. An optional ?category= query restricts to
  // vendors whose supportedCategories include that RFQ category (and the manufacturing /
  // supplier vendorType matches manufacturing_subcontractor / supplier categories).
  app.get("/api/subcontractors", async (req, res) => {
    const { role, scopeId } = roleCtx(req);
    if (role === "factory_user") {
      return res.json([]);
    }
    const all = await storage.listSubcontractors();
    const requestedCategory = typeof req.query.category === "string" ? req.query.category : undefined;
    const byCategory = (sub: typeof all[number]) =>
      !requestedCategory ||
      isVendorAllowedForCategory(
        sub.vendorType,
        sub.supportedCategories as string[],
        requestedCategory,
      );
    if (
      isBusinessApprover(role) ||
      isPlatformAdmin(role) ||
      !RolePerms.isClusterScoped(role) ||
      scopeId == null
    ) {
      return res.json(all.filter(byCategory));
    }
    // Look up the user's company cluster and filter.
    const companies = await storage.listCompanies();
    const myCompany = companies.find((c) => c.id === scopeId);
    const myCluster = myCompany?.clusterName ?? null;
    res.json(
      all
        .filter((sub) => isSubcontractorAvailableForCluster(sub.clusterAccess, myCluster))
        .filter(byCategory),
    );
  });

  app.post("/api/subcontractors", async (req, res) => {
    const { role } = roleCtx(req);
    if (!RolePerms.canManageSubcontractors(role)) {
      return deny(res, "Only Commercial Managers or Senior Management can add subcontractors.");
    }
    const parsed = insertSubcontractorSchema.parse(req.body);
    res.status(201).json(await storage.createSubcontractor(parsed));
  });

  // Edit cluster availability of a subcontractor — Senior Management or Platform Admin only.
  app.patch("/api/subcontractors/:id/cluster-access", async (req, res) => {
    const { role } = roleCtx(req);
    if (!RolePerms.canEditSubcontractorClusterAccess(role)) {
      return deny(res, "Only Senior Management or Platform Admin can change cluster availability.");
    }
    const id = asNumber(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid subcontractor id" });
    const parsed = updateSubcontractorClusterAccessSchema.parse(req.body);
    const updated = await storage.setSubcontractorClusterAccess(id, parsed.clusterAccess);
    if (!updated) return res.status(404).json({ message: "Subcontractor not found" });
    await storage.logAudit({
      eventType: "subcontractor_cluster_access_changed",
      actor: actorMeta(req),
      action: "set_cluster_access",
      summary: `${updated.name} cluster access → ${parsed.clusterAccess.length === 0 ? "Both clusters" : parsed.clusterAccess.join(", ")}`,
      metadata: { subcontractorId: id, clusterAccess: parsed.clusterAccess },
    });
    res.json(updated);
  });

  app.get("/api/rfqs", async (req, res) => {
    const { role, scopeId, user } = roleCtx(req);
    const all = await storage.listRfqs();
    const isClosedForFactory = (status: string) =>
      status === "awarded" || status === "accepted" || status === "closed" || status === "declined";

    if (role === "subcontractor_user") {
      // Vendor / subcontractor user: see ONLY RFQs they've been invited to. We resolve
      // the vendor by user.subcontractorId; if the demo user has no link, return [].
      const subId = user?.subcontractorId ?? null;
      if (!subId) return res.json([]);
      const visibleRfqIds = await storage.rfqIdsForSubcontractor(subId);
      return res.json(all.filter((rfq) => visibleRfqIds.includes(rfq.id)));
    }

    if (role === "factory_user") {
      if (!scopeId) return res.json([]);
      const visibleRfqIds = await storage.rfqIdsForFactory(scopeId);
      const visible = all.filter((rfq) => visibleRfqIds.includes(rfq.id));
      const showClosed = req.query.includeClosed === "1";
      return res.json(showClosed ? visible : visible.filter((rfq) => !isClosedForFactory(rfq.status)));
    }

    if (RolePerms.isClusterScoped(role) && scopeId) {
      // Commercial / commercial manager constrained to their own company's cluster.
      // We resolve by company → cluster, then include any RFQ whose requesting/producing company
      // is in the same cluster (commercial managers oversee the whole cluster, not one company).
      const companies = await storage.listCompanies();
      const myCompany = companies.find((c) => c.id === scopeId);
      const myCluster = myCompany?.clusterName ?? null;
      if (!myCluster) {
        return res.json(
          all.filter(
            (rfq) => rfq.requestingCompanyId === scopeId || rfq.producingCompanyId === scopeId,
          ),
        );
      }
      const clusterCompanyIds = companies.filter((c) => c.clusterName === myCluster).map((c) => c.id);
      // Commercial Manager: see entire cluster. Commercial staff: their own company + cluster RFQs.
      if (role === "commercial_manager") {
        return res.json(
          all.filter(
            (rfq) =>
              clusterCompanyIds.includes(rfq.requestingCompanyId) ||
              (rfq.producingCompanyId != null && clusterCompanyIds.includes(rfq.producingCompanyId)),
          ),
        );
      }
      return res.json(
        all.filter(
          (rfq) =>
            rfq.requestingCompanyId === scopeId ||
            rfq.producingCompanyId === scopeId ||
            clusterCompanyIds.includes(rfq.requestingCompanyId),
        ),
      );
    }

    // Senior Management / Platform Admin / fallback — see all RFQs.
    res.json(all);
  });

  app.post("/api/rfqs", async (req, res) => {
    const { role, permCtx, scopeId } = roleCtx(req);
    if (!RolePerms.canCreateRfq(role, permCtx) && role !== "factory_user") {
      return deny(
        res,
        "Only Commercial Staff, Commercial Managers, and Senior Management can create RFQs.",
      );
    }
    const parsed = insertRfqSchema.parse(req.body);

    // Wooden pallets are factory-managed. Commercial staff and commercial managers cannot
    // create pallet RFQs; only factory_user, senior_management/group_admin, and platform_admin
    // (for setup/testing) can. Anyone else is rejected here so the UI can't simply re-enable
    // the option client-side. See user requirement: pallets are not part of the commercial RFQ
    // process; factories handle them.
    if (parsed.category === "wooden_pallets") {
      const palletAllowed =
        role === "factory_user" ||
        role === "senior_management" ||
        role === "group_admin" ||
        role === "platform_admin";
      if (!palletAllowed) {
        return deny(
          res,
          "Wooden pallets are factory-managed (6-month price-validity inquiry). Commercial users cannot create pallet RFQs — ask the factory team to raise this.",
        );
      }
    }

    // Factory users can only create RFQs in their own factory-managed categories
    // (currently: wooden_pallets). They are not commercial creators.
    if (role === "factory_user" && parsed.category !== "wooden_pallets") {
      return deny(
        res,
        "Factory users can only create wooden pallet price-validity inquiries.",
      );
    }
    if (
      role === "commercial_staff" &&
      scopeId &&
      parsed.requestingCompanyId !== scopeId
    ) {
      return deny(res, "Commercial Staff can only create RFQs for their assigned company.");
    }
    if (role === "commercial_manager" && scopeId) {
      const companies = await storage.listCompanies();
      const myCompany = companies.find((c) => c.id === scopeId);
      const myCluster = myCompany?.clusterName ?? null;
      const requesting = companies.find((c) => c.id === parsed.requestingCompanyId);
      if (!requesting || requesting.clusterName !== myCluster) {
        return deny(res, "Commercial Managers can only create RFQs within their own cluster.");
      }
    }
    const created = await storage.createRfq(parsed);
    const workflow = (created as any).workflowType ?? "standard_rfq";
    const workflowLabel =
      workflow === "price_validity_inquiry"
        ? `${(created as any).priceValidityMonths ?? 6}-month price-validity inquiry`
        : workflow === "polybag_rfq"
          ? "Polythene bag inquiry (specs required)"
          : "Standard RFQ";
    await storage.logAudit({
      eventType: "rfq_created",
      rfqId: created.id,
      actor: actorMeta(req),
      action: "create_rfq",
      summary: `RFQ ${created.reference} (${created.projectName}) created · ${(created as any).category ?? "manufacturing_subcontractor"} · ${workflowLabel}`,
      metadata: {
        reference: created.reference,
        requestType: created.requestType,
        category: (created as any).category ?? "manufacturing_subcontractor",
        workflowType: workflow,
        priceValidityMonths: (created as any).priceValidityMonths ?? null,
        responseDue: created.responseDue,
        expiresAt: created.expiresAt,
        dealCloseDue: (created as any).dealCloseDue ?? null,
      },
    });
    res.status(201).json(created);
  });

  // PATCH /api/rfqs/:id — edit an existing RFQ. Permissions:
  //   • Senior Management always.
  //   • Commercial Manager (cluster-scoped check) and Commercial Staff with the
  //     'Send RFQs' grant within their assigned company.
  //   • Factory User only on wooden_pallets RFQs (their factory-managed flow).
  //   • Platform Admin explicitly cannot edit commercial RFQ content.
  // Constraints handled in storage:
  //   • Awarded / accepted / closed RFQs cannot be edited (409).
  //   • category / requestType / requestingCompany cannot change once invites exist.
  app.patch("/api/rfqs/:id", async (req, res) => {
    const { role, permCtx, scopeId } = roleCtx(req);
    const id = asNumber(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid RFQ id" });
    const detail = await storage.getRfqDetail(id);
    if (!detail) return res.status(404).json({ message: "RFQ not found" });
    if (!RolePerms.canEditRfq(role, permCtx)) {
      return deny(
        res,
        role === "commercial_staff"
          ? "Commercial staff need the 'Send RFQs' grant to edit RFQs."
          : "You don't have permission to edit RFQs.",
      );
    }
    if (role === "factory_user") {
      if ((detail.rfq.category as string) !== "wooden_pallets") {
        return deny(res, "Factory users can only edit wooden pallet RFQs.");
      }
    }
    if (role === "commercial_staff" && scopeId && detail.rfq.requestingCompanyId !== scopeId) {
      return deny(res, "Commercial staff can only edit RFQs for their assigned company.");
    }
    if (role === "commercial_manager" && scopeId) {
      const companies = await storage.listCompanies();
      const myCompany = companies.find((c) => c.id === scopeId);
      const myCluster = myCompany?.clusterName ?? null;
      const requesting = companies.find((c) => c.id === detail.rfq.requestingCompanyId);
      if (!requesting || requesting.clusterName !== myCluster) {
        return deny(res, "Commercial managers can only edit RFQs in their cluster.");
      }
    }
    try {
      const parsed = updateRfqSchema.parse(req.body);
      const result = await storage.updateRfq(id, parsed, actorMeta(req));
      if (!result) return res.status(404).json({ message: "RFQ not found" });
      await storage.logAudit({
        eventType: "rfq_updated",
        rfqId: id,
        actor: actorMeta(req),
        action: "update_rfq",
        summary: result.changedFields.length
          ? `RFQ ${result.rfq.reference} edited (${result.changedFields.join(", ")})`
          : `RFQ ${result.rfq.reference} edit submitted with no changes`,
        metadata: {
          changedFields: result.changedFields,
          reference: result.rfq.reference,
          category: (result.rfq as any).category,
        },
      });
      res.json(result.rfq);
    } catch (err) {
      if (err instanceof RfqRoutingError) {
        return res.status(err.status).json({ message: err.message });
      }
      throw err;
    }
  });

  // POST /api/rfqs/:id/invites/bulk — send the same RFQ to multiple recipients.
  // Returns { successes: [...invites], failures: [{ id, message }] }. Routing rules
  // (cluster availability, India routing, vendor category match) are still enforced
  // per-recipient inside storage.inviteRecipient.
  app.post("/api/rfqs/:id/invites/bulk", async (req, res) => {
    const { role, permCtx } = roleCtx(req);
    if (!RolePerms.canSendInvite(role, permCtx)) {
      return deny(
        res,
        role === "commercial_staff"
          ? "Commercial staff need the 'Send RFQs' grant to invite recipients."
          : "Only Commercial Managers or Senior Management can send invites.",
      );
    }
    const rfqId = asNumber(req.params.id);
    if (!rfqId) return res.status(400).json({ message: "RFQ is required" });
    if (await blockIfMissingRequiredDocs(res, rfqId, "bulk-send")) return;
    const parsed = bulkInviteSchema.parse(req.body);
    const recipientType = parsed.recipientType ?? "external_subcontractor";

    type Failure = { recipientType: string; id: number; message: string };
    const successes: any[] = [];
    const failures: Failure[] = [];

    const ids =
      recipientType === "external_subcontractor"
        ? (parsed.subcontractorIds ?? [])
        : recipientType === "internal_factory"
          ? (parsed.factoryIds ?? [])
          : (parsed.companyIds ?? []);
    if (!ids.length) {
      return res.status(400).json({ message: "Select at least one recipient." });
    }
    for (const id of ids) {
      try {
        const payload =
          recipientType === "external_subcontractor"
            ? { recipientType, subcontractorId: id, factoryId: null, companyId: null }
            : recipientType === "internal_factory"
              ? { recipientType, subcontractorId: null, factoryId: id, companyId: null }
              : { recipientType, subcontractorId: null, factoryId: null, companyId: id };
        const invite = await storage.inviteRecipient(rfqId, insertInviteSchema.parse(payload));
        successes.push(invite);
        await storage.logAudit({
          eventType: "invite_sent",
          rfqId,
          inviteId: invite.id,
          actor: actorMeta(req),
          action: "send_invite_bulk",
          summary: `Invite ${invite.id} sent (${invite.recipientType}) via bulk send`,
          metadata: {
            recipientType: invite.recipientType,
            country: invite.country,
            bulkBatch: true,
          },
        });
      } catch (err) {
        const message = err instanceof RfqRoutingError ? err.message : err instanceof Error ? err.message : "Unknown error";
        failures.push({ recipientType, id, message });
      }
    }
    await storage.logAudit({
      eventType: "invites_bulk_sent",
      rfqId,
      actor: actorMeta(req),
      action: "bulk_send",
      summary: `Bulk send: ${successes.length} sent, ${failures.length} failed`,
      metadata: {
        recipientType,
        country: parsed.country ?? null,
        successCount: successes.length,
        failureCount: failures.length,
      },
    });
    res.status(200).json({ successes, failures });
  });

  app.get("/api/rfqs/:id", async (req, res) => {
    const id = asNumber(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid RFQ id" });
    const detail = await storage.getRfqDetail(id);
    if (!detail) return res.status(404).json({ message: "RFQ not found" });

    const { role, scopeId, user } = roleCtx(req);

    if (role === "factory_user") {
      const factoryInvites = detail.invites.filter((invite) => invite.factoryId === scopeId);
      if (!factoryInvites.length) {
        return deny(res, "This RFQ is not assigned to your factory.");
      }
      const sanitizedInvites = factoryInvites.map((invite) => ({
        ...invite,
        currentPrice: null,
        priceVisibility: "hidden" as const,
        negotiations: invite.negotiations.map((n) => ({ ...n, price: null })),
      }));
      return res.json({ ...detail, invites: sanitizedInvites });
    }

    if (role === "subcontractor_user") {
      // Vendor user: only their own invite(s) are returned. We never expose other
      // vendors' names, prices, ETDs, or factory recipients on this RFQ. We also
      // strip Product Manufacturing PO context (partnerClient / poCustomerName /
      // poCountry) and the internal escalation reason — they are commercial
      // metadata for internal use only.
      const subId = user?.subcontractorId ?? null;
      if (!subId) {
        return deny(res, "This RFQ is not assigned to your account.");
      }
      const myInvites = detail.invites.filter(
        (invite) =>
          invite.recipientType === "external_subcontractor" && invite.subcontractorId === subId,
      );
      if (!myInvites.length) {
        return deny(res, "This RFQ is not assigned to your account.");
      }
      const sanitizedRfq = {
        ...detail.rfq,
        partnerClient: null as string | null,
        poCountry: null as string | null,
        poCustomerName: null as string | null,
        escalationReason: null as string | null,
      };
      return res.json({
        rfq: sanitizedRfq,
        // Also strip the producing factory — vendors don't need to know which TEG
        // factory consumes the goods, and producingCompany is omitted.
        requestingCompany: detail.requestingCompany ?? null,
        producingCompany: null,
        producingFactory: null,
        invites: myInvites,
      });
    }

    return res.json(detail);
  });

  app.post("/api/rfqs/:id/invites", async (req, res) => {
    const { role, permCtx } = roleCtx(req);
    if (!RolePerms.canSendInvite(role, permCtx)) {
      return deny(
        res,
        role === "commercial_staff"
          ? "Commercial staff need the 'Send RFQs' grant to invite recipients."
          : "Only Commercial Managers or Senior Management can send invites.",
      );
    }
    const rfqId = asNumber(req.params.id);
    if (!rfqId) return res.status(400).json({ message: "RFQ is required" });
    if (await blockIfMissingRequiredDocs(res, rfqId, "send")) return;
    const parsed = insertInviteSchema.parse(req.body);
    try {
      const invite = await storage.inviteRecipient(rfqId, parsed);
      await storage.logAudit({
        eventType: "invite_sent",
        rfqId,
        inviteId: invite.id,
        actor: actorMeta(req),
        action: "send_invite",
        summary: `Invite ${invite.id} sent (${invite.recipientType})`,
        metadata: { recipientType: invite.recipientType, country: invite.country, rfqCategory: (invite as any).category ?? null },
      });
      res.status(201).json(invite);
    } catch (err) {
      if (err instanceof RfqRoutingError) {
        return res.status(err.status).json({ message: err.message });
      }
      throw err;
    }
  });

  app.post("/api/rfqs/:id/escalate", async (req, res) => {
    const { role, permCtx } = roleCtx(req);
    if (!RolePerms.canEscalate(role, permCtx)) {
      return deny(
        res,
        role === "commercial_staff"
          ? "Commercial staff need 'Send RFQs' permission to escalate."
          : "Only Commercial Managers or Senior Management can escalate to external subcontractors.",
      );
    }
    const rfqId = asNumber(req.params.id);
    const subcontractorId = Number(req.body.subcontractorId);
    const reason = String(req.body.reason || "").trim();
    if (!rfqId || !subcontractorId || !reason) {
      return res.status(400).json({ message: "RFQ, external subcontractor, and reason are required" });
    }
    if (await blockIfMissingRequiredDocs(res, rfqId, "send")) return;
    try {
      res.status(201).json(await storage.escalateToExternal(rfqId, subcontractorId, reason));
    } catch (err) {
      if (err instanceof RfqRoutingError) {
        return res.status(err.status).json({ message: err.message });
      }
      throw err;
    }
  });

  app.post("/api/rfqs/:id/award", async (req, res) => {
    const { role } = roleCtx(req);
    if (!RolePerms.canAcceptOrAward(role)) {
      return deny(
        res,
        "Only Senior Management can finalise an award. Platform Admin, Commercial Manager, and Commercial Staff cannot.",
      );
    }
    const rfqId = asNumber(req.params.id);
    const inviteId = asNumber(String(req.body.inviteId ?? ""));
    const manualReason = typeof req.body.closureReason === "string" ? req.body.closureReason : undefined;
    if (!rfqId || !inviteId) {
      return res.status(400).json({ message: "rfqId and inviteId are required" });
    }
    if (await blockIfMissingRequiredDocs(res, rfqId, "award")) return;
    const detail = await storage.awardInvite(rfqId, inviteId, manualReason);
    if (!detail) return res.status(404).json({ message: "Invite not found for RFQ" });
    await storage.logAudit({
      eventType: "award_approved",
      rfqId,
      inviteId,
      actor: actorMeta(req),
      action: "award_invite",
      summary: `RFQ ${detail.rfq.reference} awarded to invite ${inviteId}`,
      metadata: { closureReason: manualReason ?? null },
    });
    res.status(200).json(detail);
  });

  app.post("/api/invites/:id/closure", async (req, res) => {
    const { role } = roleCtx(req);
    if (!RolePerms.canAcceptOrAward(role)) {
      return deny(res, "Only Senior Management can edit an invite closure reason.");
    }
    const inviteId = asNumber(req.params.id);
    if (!inviteId) return res.status(400).json({ message: "Invalid invite id" });
    const reason = String(req.body.reason || "").trim() || DEFAULT_CLOSURE_REASON;
    const updated = await storage.setInviteClosure(inviteId, reason);
    if (!updated) return res.status(404).json({ message: "Invite not found" });
    res.json(updated);
  });

  app.post("/api/invites/:id/negotiations", async (req, res) => {
    const { role, scopeId } = roleCtx(req);
    const inviteId = asNumber(req.params.id);
    if (!inviteId) return res.status(400).json({ message: "Invalid invite id" });
    const invite = await storage.getInviteById(inviteId);
    if (!invite) return res.status(404).json({ message: "Invite not found" });

    const actor = String(req.body.actor || "");

    // External vendor quote/counter validation: Product Manufacturing and Polythene Bags
    // require BOTH price and ETD on every submitted quote or counter. This check runs
    // BEFORE role checks so a UI bypass that hits this endpoint directly cannot submit
    // an incomplete external vendor response. Internal hidden-price (factory_user /
    // intercompany ETD-only) flows remain ETD-only and are unaffected. Accept / decline /
    // message / escalate actions are NOT subject to this requirement — they don't carry
    // new price/ETD by design.
    {
      const submittedAction = String(req.body.action || "");
      const isQuoteOrCounter = submittedAction === "quote" || submittedAction === "counter";
      const isExternalVendorActor =
        invite.recipientType === "external_subcontractor" && actor === "subcontractor";
      if (isQuoteOrCounter && isExternalVendorActor) {
        const rfqDetail = await storage.getRfqDetail(invite.rfqId);
        const category = (rfqDetail?.rfq as any)?.category ?? "manufacturing_subcontractor";
        if (category === "manufacturing_subcontractor" || category === "polythene_bags") {
          const missing: string[] = [];
          const priceVal = req.body.price;
          const etdVal = req.body.etd;
          const priceMissing =
            priceVal === undefined || priceVal === null || priceVal === "" || Number(priceVal) <= 0;
          const etdMissing = etdVal === undefined || etdVal === null || String(etdVal).trim() === "";
          if (priceMissing) missing.push("Price (USD) required");
          if (etdMissing) missing.push("ETD / delivery date required");
          if (missing.length > 0) {
            return res.status(422).json({
              message: `External vendor responses for ${
                category === "polythene_bags" ? "Polythene Bags" : "Product Manufacturing"
              } must include both price and ETD.`,
              errors: missing,
              fields: {
                price: priceMissing ? "Price (USD) required" : null,
                etd: etdMissing ? "ETD / delivery date required" : null,
              },
            });
          }
        }
      }
    }

    if (role === "factory_user") {
      if (invite.factoryId !== scopeId) {
        return deny(res, "Factory users may only respond to invites for their factory.");
      }
      if (invite.priceVisibility !== "hidden") {
        return deny(res, "Factory users cannot respond on commercial / price-visible invites.");
      }
      if (req.body.price !== undefined && req.body.price !== null) {
        return deny(res, "Factory users cannot submit prices.");
      }
      if (actor !== "factory") {
        return deny(res, "Factory users must act as 'factory'.");
      }
    } else if (isBusinessApprover(role)) {
      if (actor !== "buyer") {
        // "buyer" is preserved as the internal-team actor identifier in the negotiation
        // schema (back-compat with existing rows). UI surfaces it as "TEG team".
        return deny(res, "Dashboard users must act as 'buyer' (internal team) on their controls.");
      }
      if (invite.priceVisibility === "hidden" && req.body.price !== undefined && req.body.price !== null) {
        return deny(res, "Price is not allowed on internal ETD-only invites.");
      }
    } else if (role === "commercial_staff" || role === "commercial_manager") {
      const { permCtx } = roleCtx(req);
      if (!RolePerms.canBuyerNegotiate(role, permCtx)) {
        return deny(
          res,
          role === "commercial_staff"
            ? "Commercial staff need the 'Negotiate' grant to send counters or messages."
            : "Commercial managers cannot negotiate without an explicit grant.",
        );
      }
      if (actor !== "buyer") {
        // Internal-team actor type is still "buyer" in the schema for back-compat;
        // the role itself has been retired in favour of Commercial Staff / Manager.
        return deny(res, "Commercial roles must act as 'buyer' (internal team) on internal controls.");
      }
      const action = String(req.body.action || "");
      if (action === "accept" || action === "decline") {
        return deny(
          res,
          "Commercial roles cannot accept or decline an RFQ. Only Senior Management can.",
        );
      }
      if (invite.priceVisibility === "hidden" && req.body.price !== undefined && req.body.price !== null) {
        return deny(res, "Price is not allowed on internal ETD-only invites.");
      }
    } else if (isPlatformAdmin(role)) {
      return deny(
        res,
        "Platform Admin cannot send negotiation messages. Sign in as Senior Management or Commercial Staff.",
      );
    }

    const parsed = insertNegotiationSchema.parse({ ...req.body, inviteId });
    const negotiation = await storage.addNegotiation(parsed);
    const eventType =
      parsed.actor === "buyer"
        ? "buyer_counter"
        : invite.priceVisibility === "visible"
          ? "quote_submitted"
          : "etd_submitted";
    await storage.logAudit({
      eventType,
      rfqId: invite.rfqId,
      inviteId,
      actor: actorMeta(req),
      action: parsed.action,
      summary: `${parsed.actor} ${parsed.action} on invite ${inviteId}`,
      metadata: { price: parsed.price ?? null, etd: parsed.etd ?? null },
    });
    res.status(201).json(negotiation);
  });

  // Token portal — accessible to anyone holding the token (subcontractor or factory)
  app.get("/api/portal/:token", async (req, res) => {
    const resolved = await storage.resolveInviteByToken(req.params.token);
    if (!resolved) return res.status(404).json({ message: "RFQ invitation not found" });
    if (resolved.tokenState.kind === "revoked") {
      return res.status(410).json({
        message:
          "This portal link has been revoked. Please contact your TEG contact for a new link.",
        tokenState: resolved.tokenState,
      });
    }
    if (resolved.tokenState.kind === "expired") {
      return res.status(410).json({
        message:
          "This portal link has expired. Please contact your TEG contact to extend it if a response is still needed.",
        tokenState: resolved.tokenState,
      });
    }
    res.json({ ...resolved.detail, tokenState: resolved.tokenState });
  });

  app.get("/api/portal/:token/notifications", async (req, res) => {
    const detail = await storage.getInviteByToken(req.params.token);
    if (!detail) return res.status(404).json({ message: "RFQ invitation not found" });
    const invite = detail.invites[0];
    if (!invite) return res.json([]);
    const notes = await storage.listNotificationsForInvite(invite.id);
    res.json(notes);
  });

  app.post("/api/portal/:token/notifications/:id/read", async (req, res) => {
    const detail = await storage.getInviteByToken(req.params.token);
    if (!detail) return res.status(404).json({ message: "RFQ invitation not found" });
    const invite = detail.invites[0];
    if (!invite) return res.status(404).json({ message: "Invite not found" });
    const notificationId = asNumber(req.params.id);
    if (!notificationId) return res.status(400).json({ message: "Invalid notification id" });
    const portalNotes = await storage.listNotificationsForInvite(invite.id);
    if (!portalNotes.some((n) => n.id === notificationId)) {
      return res.status(404).json({ message: "Notification not found" });
    }
    const updated = await storage.markNotificationRead(notificationId, "subcontractor_user");
    if (!updated) return res.status(404).json({ message: "Notification not found" });
    res.json(updated);
  });

  // ---------- Notifications ----------
  app.get("/api/notifications", async (req, res) => {
    const { role, scopeId } = roleCtx(req);
    const rfqId = req.query.rfqId ? asNumber(String(req.query.rfqId)) : undefined;
    const notes = await storage.listNotificationsForRole({ role, scopeId, rfqId });
    res.json(notes);
  });

  app.post("/api/notifications/:id/read", async (req, res) => {
    const { role, scopeId } = roleCtx(req);
    const id = asNumber(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid notification id" });
    const visible = await storage.listNotificationsForRole({ role, scopeId });
    if (!visible.some((n) => n.id === id)) {
      return deny(res, "You cannot mark a notification you don't have access to.");
    }
    const updated = await storage.markNotificationRead(id, role);
    if (!updated) return res.status(404).json({ message: "Notification not found" });
    res.json(updated);
  });

  app.post("/api/notifications/read-all", async (req, res) => {
    const { role, scopeId } = roleCtx(req);
    const count = await storage.markAllNotificationsRead({ role, scopeId });
    res.json({ count });
  });

  // ---------- Award recommendations ----------
  app.get("/api/rfqs/:id/recommendations", async (req, res) => {
    const { role } = roleCtx(req);
    if (!RolePerms.canViewAwardRecommendations(role)) {
      return deny(res, "Recommendations are only visible to internal staff.");
    }
    const rfqId = asNumber(req.params.id);
    if (!rfqId) return res.status(400).json({ message: "Invalid RFQ id" });
    res.json(await storage.listAwardRecommendations(rfqId));
  });

  app.post("/api/rfqs/:id/recommendations", async (req, res) => {
    const { role, permCtx } = roleCtx(req);
    if (!RolePerms.canSubmitAwardRecommendation(role, permCtx)) {
      if (role === "commercial_staff") {
        return deny(
          res,
          "Commercial staff need the 'Recommend awards' grant from Senior Management.",
        );
      }
      return deny(
        res,
        "Only commercial staff with the recommend-awards grant can submit recommendations.",
      );
    }
    const rfqId = asNumber(req.params.id);
    if (!rfqId) return res.status(400).json({ message: "Invalid RFQ id" });
    try {
      const parsed = insertAwardRecommendationSchema.parse(req.body);
      const rec = await storage.createAwardRecommendation(rfqId, role, parsed);
      await storage.logAudit({
        eventType: "recommendation_submitted",
        rfqId,
        inviteId: rec.inviteId,
        recommendationId: rec.id,
        actor: actorMeta(req),
        action: "submit_recommendation",
        summary: `Award recommendation submitted on RFQ ${rfqId}`,
        metadata: { rationale: rec.rationale.slice(0, 200) },
      });
      res.status(201).json(rec);
    } catch (err) {
      if (err instanceof RfqRoutingError) {
        return res.status(err.status).json({ message: err.message });
      }
      throw err;
    }
  });

  app.post("/api/recommendations/:id/decision", async (req, res) => {
    const { role } = roleCtx(req);
    if (!RolePerms.canDecideAwardRecommendation(role)) {
      return deny(
        res,
        "Only Senior Management can approve, reject, or return award recommendations.",
      );
    }
    const id = asNumber(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid recommendation id" });

    const parsed = recommendationDecisionSchema.parse(req.body);
    const decision =
      parsed.action === "approve"
        ? "approved"
        : parsed.action === "reject"
          ? "rejected"
          : "returned";

    const existing = await storage.getAwardRecommendation(id);
    if (!existing) return res.status(404).json({ message: "Recommendation not found" });
    // Approving a recommendation finalises an award — enforce the same doc requirement
    // here so Product Manufacturing RFQs can't slip through this path. Reject + return
    // is allowed even when docs are missing (no commercial commitment).
    if (parsed.action === "approve") {
      if (await blockIfMissingRequiredDocs(res, existing.rfqId, "recommendation")) return;
    }
    if (existing.recommendedByRole === role) {
      return deny(
        res,
        "You cannot decide a recommendation you submitted. Another approver must review it.",
      );
    }

    try {
      const result = await storage.decideAwardRecommendation(
        id,
        decision,
        role,
        parsed.decisionNote,
        parsed.closureReason,
      );
      await storage.logAudit({
        eventType: "recommendation_decided",
        rfqId: existing.rfqId,
        inviteId: existing.inviteId,
        recommendationId: id,
        actor: actorMeta(req),
        action: parsed.action,
        summary: `Recommendation ${id} ${decision}`,
        metadata: { decisionNote: parsed.decisionNote ?? null },
      });
      res.json(result);
    } catch (err) {
      if (err instanceof RfqRoutingError) {
        return res.status(err.status).json({ message: err.message });
      }
      throw err;
    }
  });

  // ---------- Document requirement status ----------
  // Returns only present/missing booleans — NO filenames, NO sizes, NO metadata.
  // Visible to internal roles (Senior Management, Commercial Manager, Commercial
  // Staff, Platform Admin) so the UI can show a checklist. Factory users see
  // their own RFQs and may also see the high-level status (still booleans only).
  // Subcontractors hit /api/portal/* paths instead and never reach this endpoint.
  app.get("/api/rfqs/:id/document-requirements", async (req, res) => {
    const rfqId = asNumber(req.params.id);
    if (!rfqId) return res.status(400).json({ message: "Invalid RFQ id" });
    const detail = await storage.getRfqDetail(rfqId);
    if (!detail) return res.status(404).json({ message: "RFQ not found" });
    const status = await storage.getDocumentRequirementStatus(rfqId);
    res.json(status);
  });

  // ---------- RFQ amendment / version history ----------
  // Internal full history — visible to senior_management, group_admin, commercial_manager,
  // commercial_staff (within scope). Platform Admin can also see audit-style history
  // since they already have audit-trail access. Factory user / subcontractor never reach
  // this endpoint (the global subcontractor block above + the cluster check below).
  app.get("/api/rfqs/:id/amendments", async (req, res) => {
    const { role, scopeId } = roleCtx(req);
    const rfqId = asNumber(req.params.id);
    if (!rfqId) return res.status(400).json({ message: "Invalid RFQ id" });
    const detail = await storage.getRfqDetail(rfqId);
    if (!detail) return res.status(404).json({ message: "RFQ not found" });
    // Only internal decision roles + platform admin can see the full history.
    const allowed =
      isBusinessApprover(role) ||
      isPlatformAdmin(role) ||
      role === "commercial_manager" ||
      role === "commercial_staff";
    if (!allowed) {
      return deny(res, "RFQ amendment history is restricted to senior management and commercial roles.");
    }
    if (
      RolePerms.isClusterScoped(role) &&
      scopeId &&
      detail.rfq.requestingCompanyId !== scopeId &&
      detail.rfq.producingCompanyId !== scopeId
    ) {
      return deny(res, "This RFQ is outside your cluster.");
    }
    res.json(await storage.listAmendments(rfqId));
  });

  // Portal-safe amendment history. Returns only revisionNumber / safeSummary /
  // createdAt — never reasons, internal summaries, changedBy, or per-field values.
  app.get("/api/portal/:token/amendments", async (req, res) => {
    const detail = await storage.getInviteByToken(req.params.token);
    if (!detail) return res.status(404).json({ message: "RFQ invitation not found" });
    const safe = await storage.listAmendmentsSafe(detail.rfq.id);
    res.json(safe);
  });

  // ---------- RFQ reference documents ----------
  // Visibility (list / download / delete) is restricted to Senior Management.
  // Uploads are additionally allowed for RFQ creators (commercial staff / manager)
  // so the create flow can attach the source PO + Pricing Quotation. Uploaders
  // cannot list or download what they just attached — only Senior Management can.
  function requireReferenceDocViewAccess(req: Request, res: Response): boolean {
    const role = (req as unknown as RoleRequest).role;
    if (!RolePerms.canViewReferenceDocuments(role)) {
      deny(
        res,
        "Reference documents (Purchase Order, Pricing Quotation) are restricted to Senior Management.",
      );
      return false;
    }
    return true;
  }

  function requireReferenceDocUploadAccess(req: Request, res: Response): boolean {
    const { role, permCtx } = roleCtx(req);
    if (!RolePerms.canUploadReferenceDocuments(role, permCtx)) {
      deny(
        res,
        "Only Senior Management or RFQ creators (Commercial Manager / Staff) can attach reference documents.",
      );
      return false;
    }
    return true;
  }

  app.get("/api/rfqs/:id/documents", async (req, res) => {
    if (!requireReferenceDocViewAccess(req, res)) return;
    const rfqId = asNumber(req.params.id);
    if (!rfqId) return res.status(400).json({ message: "Invalid RFQ id" });
    const detail = await storage.getRfqDetail(rfqId);
    if (!detail) return res.status(404).json({ message: "RFQ not found" });
    res.json(await storage.listRfqDocuments(rfqId));
  });

  app.post("/api/rfqs/:id/documents", async (req, res) => {
    if (!requireReferenceDocUploadAccess(req, res)) return;
    const rfqId = asNumber(req.params.id);
    if (!rfqId) return res.status(400).json({ message: "Invalid RFQ id" });
    const detail = await storage.getRfqDetail(rfqId);
    if (!detail) return res.status(404).json({ message: "RFQ not found" });
    const parsed = insertRfqDocumentSchema.parse(req.body);
    const role = (req as unknown as RoleRequest).role;
    const saved = await storage.saveRfqDocument(rfqId, role, parsed);
    await storage.logAudit({
      eventType: "document_uploaded",
      rfqId,
      documentId: saved.id,
      actor: actorMeta(req),
      action: "upload_document",
      summary: `Uploaded ${parsed.documentType} '${parsed.filename}'`,
      metadata: { filename: parsed.filename, mimeType: parsed.mimeType, size: parsed.size },
    });
    res.status(201).json(saved);
  });

  app.get("/api/rfqs/:id/documents/:documentId", async (req, res) => {
    if (!requireReferenceDocViewAccess(req, res)) return;
    const rfqId = asNumber(req.params.id);
    const documentId = asNumber(req.params.documentId);
    if (!rfqId || !documentId) return res.status(400).json({ message: "Invalid id" });
    const doc = await storage.getRfqDocument(rfqId, documentId);
    if (!doc) return res.status(404).json({ message: "Document not found" });

    if (req.query.download === "1" || req.query.download === "true") {
      const buffer = Buffer.from(doc.contentBase64, "base64");
      const safeName = doc.filename.replace(/"/g, "");
      res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeName}"`,
      );
      res.setHeader("Content-Length", String(buffer.length));
      return res.end(buffer);
    }

    res.json({
      id: doc.id,
      rfqId: doc.rfqId,
      documentType: doc.documentType,
      filename: doc.filename,
      mimeType: doc.mimeType,
      size: doc.size,
      uploadedBy: doc.uploadedBy,
      uploadedByRole: doc.uploadedByRole,
      uploadedAt: doc.uploadedAt,
      dataUrl: `data:${doc.mimeType};base64,${doc.contentBase64}`,
    });
  });

  app.delete("/api/rfqs/:id/documents/:documentId", async (req, res) => {
    if (!requireReferenceDocViewAccess(req, res)) return;
    const rfqId = asNumber(req.params.id);
    const documentId = asNumber(req.params.documentId);
    if (!rfqId || !documentId) return res.status(400).json({ message: "Invalid id" });
    const ok = await storage.deleteRfqDocument(rfqId, documentId);
    if (!ok) return res.status(404).json({ message: "Document not found" });
    await storage.logAudit({
      eventType: "document_deleted",
      rfqId,
      documentId,
      actor: actorMeta(req),
      action: "delete_document",
      summary: `Deleted reference document ${documentId} on RFQ ${rfqId}`,
    });
    res.json({ ok: true });
  });

  // ---------- Audit trail ----------
  app.get("/api/audit-events", async (req, res) => {
    const { role, scopeId } = roleCtx(req);
    const rfqId = req.query.rfqId ? asNumber(String(req.query.rfqId)) : undefined;
    const limit = req.query.limit ? asNumber(String(req.query.limit)) : 100;
    if (rfqId) {
      if (!RolePerms.canViewRfqAuditTrail(role)) {
        return deny(res, "Audit history is restricted.");
      }
      if (!isBusinessApprover(role) && !isPlatformAdmin(role)) {
        const detail = await storage.getRfqDetail(rfqId);
        if (!detail) return res.status(404).json({ message: "RFQ not found" });
        if (
          scopeId &&
          detail.rfq.requestingCompanyId !== scopeId &&
          detail.rfq.producingCompanyId !== scopeId
        ) {
          return deny(res, "This RFQ is outside your cluster.");
        }
      }
      return res.json(await storage.listAuditEvents({ rfqId, limit: limit ?? 100 }));
    }
    if (!RolePerms.canViewAuditTrail(role)) {
      return deny(res, "Only Senior Management and Platform Admin can view the global audit trail.");
    }
    res.json(await storage.listAuditEvents({ limit: limit ?? 100 }));
  });

  // ---------- Token management ----------
  app.post("/api/invites/:id/token/revoke", async (req, res) => {
    const { role } = roleCtx(req);
    if (!RolePerms.canManageInviteTokens(role)) {
      return deny(res, "Only Senior Management or Platform Admin can revoke portal tokens.");
    }
    const inviteId = asNumber(req.params.id);
    if (!inviteId) return res.status(400).json({ message: "Invalid invite id" });
    const updated = await storage.revokeInviteToken(inviteId, actorMeta(req));
    if (!updated) return res.status(404).json({ message: "Invite not found" });
    res.json(updated);
  });

  app.post("/api/invites/:id/token/extend", async (req, res) => {
    const { role } = roleCtx(req);
    if (!RolePerms.canManageInviteTokens(role)) {
      return deny(res, "Only Senior Management or Platform Admin can extend portal tokens.");
    }
    const inviteId = asNumber(req.params.id);
    if (!inviteId) return res.status(400).json({ message: "Invalid invite id" });
    const days = asNumber(String(req.body.businessDays ?? "5"));
    const updated = await storage.extendInviteToken(inviteId, actorMeta(req), days ?? 5);
    if (!updated) return res.status(404).json({ message: "Invite not found" });
    res.json(updated);
  });

  return httpServer;
}
