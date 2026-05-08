import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, Award, Building2, CheckCircle2, Clock3, Factory, FileText, Globe2, Handshake, Plus, Send, ShieldOff, Split, Trash2, Upload, UploadCloud, X, XCircle } from "lucide-react";
import { useForm, useFieldArray, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { UserDirectory } from "@/components/user-directory";
import { AuthSetupNote } from "@/components/auth-setup-note";
import { SystemSettingsPanel } from "@/components/system-settings-panel";
import { SubcontractorClusterAccessPanel } from "@/components/subcontractor-cluster-access";
import { YourAccessCard } from "@/components/your-access-card";
import { RfqDocumentsPanel } from "@/components/rfq-documents-panel";
import { QuoteComparisonTable } from "@/components/quote-comparison-table";
import { AmendmentHistoryPanel } from "@/components/amendment-history-panel";
import { DocumentRequirementChecklist } from "@/components/document-requirement-checklist";
import { NotificationCenter } from "@/components/notification-center";
import {
  AdminRecommendationReviewPanel,
  CommercialRecommendationForm,
  RecommendationStatusBadge,
  type Recommendation,
  type RecommendationInvite,
} from "@/components/award-recommendations";
import { useRole } from "@/lib/role-context";
import { AuditTrailPanel } from "@/components/audit-trail-panel";
import { RfqExpiryCountdown, DealCloseCountdown } from "@/components/expiry-countdown";
import {
  INDIA_BLOCKED_MESSAGE,
  INDIA_BLOCKED_REQUESTING_COMPANY_CODES,
  RolePerms,
  isVendorAllowedForCategory,
} from "@shared/roles";
import { formatUSD } from "@shared/lib";
import {
  DEFAULT_PRICE_VALIDITY_MONTHS,
  DEFAULT_RFQ_RESPONSE_BUSINESS_DAYS,
  RFQ_CATEGORIES,
  RFQ_CATEGORY_META,
  VENDOR_TYPES,
  MANUFACTURING_PRODUCT_TYPES,
  MANUFACTURING_PRODUCT_TYPE_META,
  isWeightProductType,
  workflowForCategory,
  type RfqCategory,
  type SystemSettings,
  type VendorType,
  type WorkflowType,
  type ManufacturingProductType,
  type ProductionSplitRow,
  type ProductLine,
} from "@shared/schema";

type Company = {
  id: number;
  name: string;
  clusterName: string;
  code: string;
};

type FactoryLocation = {
  id: number;
  companyId: number;
  name: string;
  country: string;
  location: string;
};

type Subcontractor = {
  id: number;
  name: string;
  contactName: string;
  email: string;
  specialty: string;
  country: "Sri Lanka" | "India" | "Indonesia";
  rating: string;
  clusterAccess: string[]; // [] = both clusters
  vendorType: VendorType;
  supportedCategories: RfqCategory[];
  materialsSupplied?: string | null;
};

function clusterAccessLabel(clusterAccess: string[] | undefined): string {
  if (!clusterAccess || clusterAccess.length === 0) return "Both clusters";
  if (clusterAccess.length === 1) return clusterAccess[0];
  return "Both clusters";
}

type Rfq = {
  id: number;
  reference: string;
  requestType: "external_rfq" | "internal_etd" | "intercompany";
  category: RfqCategory;
  workflowType?: WorkflowType;
  priceValidityMonths?: number | null;
  materialSpecs?: string;
  requestingCompanyId: number;
  producingCompanyId?: number | null;
  producingFactoryId?: number | null;
  clusterName: string;
  priceVisibility: "visible" | "hidden";
  negotiationScope: "price_etd" | "etd_only";
  escalationReason?: string | null;
  projectName: string;
  packageName: string;
  description: string;
  quantity: string;
  unit: string;
  targetEtd: string;
  responseDue: string;
  expiresAt?: string | null;
  status: string;
  awardedInviteId?: number | null;
  awardedAt?: string | null;
  // Product Manufacturing PO context. Null on non-manufacturing RFQs.
  partnerClient?: string | null;
  poCountry?: string | null;
  poCustomerName?: string | null;
  createdAt: string;
};

type PartnerClient = {
  id: number;
  name: string;
  country: string;
  clusterName: string;
  active: boolean;
};

type PoExtractResult = {
  partnerClient: string | null;
  poCountry: string | null;
  poCustomerName: string | null;
  confidence: "high" | "medium" | "low" | "none";
  matchedLabels: string[];
  notes: string[];
  textExtractionFailed: boolean;
};

type Negotiation = {
  id: number;
  actor: "buyer" | "subcontractor" | "factory";
  action: "quote" | "counter" | "accept" | "decline" | "message" | "escalate";
  price?: number | null;
  etd?: string | null;
  note: string;
  createdAt: string;
};

type Invite = {
  id: number;
  token: string;
  recipientType: "external_subcontractor" | "internal_factory" | "internal_company";
  country: string;
  priceVisibility: "visible" | "hidden";
  negotiationScope: "price_etd" | "etd_only";
  status: string;
  currentPrice?: number | null;
  currentEtd?: string | null;
  lastNote?: string | null;
  closureReason?: string | null;
  closedAt?: string | null;
  recipientName: string;
  recipientContact: string;
  recipientEmail: string;
  negotiations: Negotiation[];
};

type RfqDetail = {
  rfq: Rfq;
  requestingCompany?: Company | null;
  producingCompany?: Company | null;
  producingFactory?: FactoryLocation | null;
  invites: Invite[];
};

type Overview = {
  totalRfqs: number;
  activeNegotiations: number;
  acceptedOrders: number;
  pendingResponses: number;
  etdOnlyRequests: number;
  externalEscalations: number;
};

const rfqFormSchema = z
  .object({
    requestType: z.enum(["external_rfq", "internal_etd", "intercompany"]),
    category: z.enum(RFQ_CATEGORIES),
    requestingCompanyId: z.string().min(1, "Select the requesting company"),
    producingCompanyId: z.string().optional(),
    producingFactoryId: z.string().optional(),
    // Generic create fields. Required for non-manufacturing categories; optional for
    // Product Manufacturing where Partner / Country / PO Customer replace them.
    projectName: z.string().optional().default(""),
    packageName: z.string().optional().default(""),
    description: z.string().optional().default(""),
    // Product Manufacturing PO context. Required when category=manufacturing_subcontractor.
    partnerClient: z.string().optional().default(""),
    poCountry: z.string().optional().default(""),
    poCustomerName: z.string().optional().default(""),
    // For manufacturing RFQs, the visible quantity/unit are captured per product line
    // (and the top-level columns are derived on submit). For other categories these
    // remain required — enforced inside superRefine.
    quantity: z.string().optional().default(""),
    unit: z.string().optional().default(""),
    targetEtd: z.string().min(1, "Target ETD is required"),
    // Server defaults to 1 calendar day (~24 hours) when blank — see DEFAULT_RFQ_RESPONSE_DAYS.
    // Configurable via the System Settings panel.
    responseDue: z.string().optional().default(""),
    // Polybag inquiry specs — required only when category === polythene_bags.
    // Marketed (market) size + actual bag size, each with L/W/H. Plus gauge, ETD required.
    marketedLength: z.string().optional().default(""),
    marketedWidth: z.string().optional().default(""),
    marketedHeight: z.string().optional().default(""),
    actualLength: z.string().optional().default(""),
    actualWidth: z.string().optional().default(""),
    actualHeight: z.string().optional().default(""),
    gauge: z.string().optional().default(""),
    etdRequired: z.string().optional().default(""),
    // Manufacturing-subcontractor specs — LEGACY single-product fields kept for back-compat.
    // Multi-product RFQs use productLines below; single-product creates can still fill these
    // and the server normalizes to one productLine.
    materialSpecification: z.string().optional().default(""),
    productSize: z.string().optional().default(""),
    ecLevel: z.string().optional().default(""),
    manufacturingProductType: z.string().optional().default(""),
    // Multi-product Product Manufacturing lines. Required for ANY manufacturing RFQ
    // (external, internal_etd, intercompany). Each line carries its own product type,
    // material, size/weight, EC level, quantity, loadability per container.
    productLines: z
      .array(
        z.object({
          productType: z.string().optional().default(""),
          materialSpecification: z.string().optional().default(""),
          productSize: z.string().optional().default(""),
          ecLevel: z.string().optional().default(""),
          quantity: z.string().optional().default(""),
          loadabilityPerContainer: z.string().optional().default(""),
          notes: z.string().optional().default(""),
        }),
      )
      .optional()
      .default([]),
    // NOTE: production splits are NOT collected on the create form anymore. They are
    // added per-product-line through Edit RFQ after the RFQ is created.
    // Optional override for price-validity workflow; defaults to 6 months on the server.
    priceValidityMonths: z.string().optional().default(""),
  })
  .superRefine((values, ctx) => {
    if (values.category === "polythene_bags") {
      const dims: Array<[keyof typeof values, string]> = [
        ["marketedLength", "Marketed size length is required"],
        ["marketedWidth", "Marketed size width is required"],
        ["marketedHeight", "Marketed size height is required"],
        ["actualLength", "Actual bag length is required"],
        ["actualWidth", "Actual bag width is required"],
        ["actualHeight", "Actual bag height is required"],
      ];
      for (const [key, msg] of dims) {
        const v = values[key] as string | undefined;
        if (!v || v.trim().length < 1) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key as string], message: msg });
        }
      }
      if (!values.gauge || values.gauge.trim().length < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gauge"], message: "Gauge is required for polythene bag inquiries" });
      }
      if (!values.etdRequired || values.etdRequired.trim().length < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["etdRequired"], message: "ETD required is mandatory for polythene bag inquiries" });
      }
    }
    // Non-manufacturing categories require top-level quantity + unit and the legacy
    // Project / Order / Scope fields. Manufacturing replaces these with the PO context.
    if (values.category !== "manufacturing_subcontractor") {
      if (!values.quantity || values.quantity.trim().length < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantity"], message: "Quantity is required" });
      }
      if (!values.unit || values.unit.trim().length < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["unit"], message: "Unit is required" });
      }
      if (!values.projectName || values.projectName.trim().length < 2) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["projectName"], message: "Project name is required" });
      }
      if (!values.packageName || values.packageName.trim().length < 2) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["packageName"], message: "Order / package name is required" });
      }
      if (!values.description || values.description.trim().length < 10) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["description"], message: "Describe what needs to be produced or quoted" });
      }
    } else {
      // Product Manufacturing requires Partner / Country / PO Customer.
      if (!values.partnerClient || values.partnerClient.trim().length < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["partnerClient"], message: "Partner / Client is required" });
      }
      if (!values.poCountry || values.poCountry.trim().length < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["poCountry"], message: "Country is required" });
      }
      if (!values.poCustomerName || values.poCustomerName.trim().length < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["poCustomerName"], message: "Customer name (as stated on PO) is required" });
      }
    }
    // Product Manufacturing RFQs (external, internal_etd, intercompany) all require at
    // least one valid product line.
    if (values.category === "manufacturing_subcontractor") {
      const lines = values.productLines ?? [];
      if (lines.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["productLines"],
          message: "Add at least one product to this RFQ.",
        });
      }
      lines.forEach((line, idx) => {
        if (!line.productType) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["productLines", idx, "productType"], message: "Pick a product type" });
        }
        if (!line.materialSpecification || line.materialSpecification.trim().length < 1) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["productLines", idx, "materialSpecification"], message: "Material specification is required" });
        }
        const isWeight = isWeightProductType(
          (line.productType || null) as ManufacturingProductType | null,
        );
        if (!line.productSize || line.productSize.trim().length < 1) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["productLines", idx, "productSize"], message: isWeight ? "Weight is required" : "Product size is required" });
        }
        if (!line.ecLevel || line.ecLevel.trim().length < 1) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["productLines", idx, "ecLevel"], message: "EC level is required" });
        }
        if (!line.quantity || line.quantity.trim().length < 1) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["productLines", idx, "quantity"], message: "Quantity is required" });
        }
        if (!line.loadabilityPerContainer || line.loadabilityPerContainer.trim().length < 1) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["productLines", idx, "loadabilityPerContainer"], message: "Loadability per container is required" });
        }
      });
    }
    // Splits are no longer collected on the create form.
  });

const subcontractorSchema = z.object({
  name: z.string().min(2, "Company name is required"),
  contactName: z.string().min(2, "Contact name is required"),
  email: z.string().email("Use a valid email address"),
  specialty: z.string().min(2, "Specialty is required"),
  country: z.enum(["Sri Lanka", "India", "Indonesia"]),
  rating: z.string().min(1, "Rating is required"),
  vendorType: z.enum(VENDOR_TYPES),
  supportedCategories: z.array(z.enum(RFQ_CATEGORIES)).default([]),
  materialsSupplied: z.string().max(2000).optional(),
});

function responseSchema(priceVisible: boolean) {
  return z
    .object({
      price: z.coerce.number().int().positive("Price must be greater than zero").optional(),
      etd: z.string().min(1, "ETD is required"),
      note: z.string().min(3, "Add a negotiation note"),
    })
    .refine((value) => !priceVisible || Boolean(value.price), {
      message: "Price is required for external RFQs",
      path: ["price"],
    });
}

// All TEG amounts are USD (TEG is a Sri Lanka-based export company).
function formatPrice(value?: number | null) {
  return formatUSD(value);
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function typeLabel(requestType: string) {
  if (requestType === "external_rfq") return "External commercial RFQ";
  if (requestType === "internal_etd") return "Internal ETD-only request";
  return "Intercompany production request";
}

function categoryLabel(category: RfqCategory | string | undefined): string {
  if (!category) return RFQ_CATEGORY_META.manufacturing_subcontractor.label;
  return RFQ_CATEGORY_META[category as RfqCategory]?.label ?? category;
}

function categoryShortLabel(category: RfqCategory | string | undefined): string {
  if (!category) return RFQ_CATEGORY_META.manufacturing_subcontractor.shortLabel;
  return RFQ_CATEGORY_META[category as RfqCategory]?.shortLabel ?? category;
}

function recipientLabel(type: string) {
  if (type === "external_subcontractor") return "External subcontractor";
  if (type === "internal_factory") return "Internal factory";
  return "Internal company";
}

function statusClass(status: string) {
  if (status === "accepted") return "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200";
  if (status === "declined") return "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200";
  if (status === "external_escalated") return "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200";
  if (status === "under_negotiation" || status === "quoted")
    return "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-200";
  return "bg-secondary text-secondary-foreground";
}

// Friendly label for the prominent request-type picker. Used by the create form and edit dialog.
const REQUEST_TYPE_OPTIONS: Array<{
  value: "external_rfq" | "internal_etd" | "intercompany";
  title: string;
  description: string;
}> = [
  {
    value: "external_rfq",
    title: "External Vendor / Subcontractor RFQ",
    description:
      "Send an inquiry to outside vendors or manufacturing subcontractors. Pick a category and recipients (USD prices visible).",
  },
  {
    value: "internal_etd",
    title: "Internal Factory ETD Request",
    description:
      "Ask an internal TEG factory to confirm dispatch dates only. Locked to manufacturing; pricing remains hidden from the factory.",
  },
  {
    value: "intercompany",
    title: "Intercompany Production Request",
    description:
      "Route production to another TEG company in your cluster. Locked to manufacturing; ETD-only thread, no price exchange.",
  },
];

function FactoryControls({ invite, rfqId }: { invite: Invite; rfqId: number }) {
  const form = useForm<{ etd: string; note: string }>({
    defaultValues: { etd: invite.currentEtd ?? "", note: "" },
  });
  const mutation = useMutation({
    mutationFn: async (payload: { action: "counter" | "accept" | "decline"; etd?: string; note: string }) => {
      const response = await apiRequest("POST", `/api/invites/${invite.id}/negotiations`, {
        ...payload,
        actor: "factory",
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfqs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfqs", rfqId] });
      queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
      form.reset({ etd: invite.currentEtd ?? "", note: "" });
    },
  });
  const disabled = invite.status === "accepted" || invite.status === "declined";

  return (
    <div className="rounded-xl border bg-card/60 p-4" data-testid={`form-factory-response-${invite.id}`}>
      <Form {...form}>
        <form
          className="grid gap-3"
          onSubmit={form.handleSubmit((values) => {
            if (!values.etd || values.note.length < 3) return;
            mutation.mutate({ action: "counter", etd: values.etd, note: values.note });
          })}
        >
          <FormField
            control={form.control}
            name="etd"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Earliest ETD you can commit</FormLabel>
                <FormControl>
                  <Input type="date" disabled={disabled} data-testid={`input-factory-etd-${invite.id}`} {...field} />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="note"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Capacity / constraint note</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Describe capacity, line allocation, or reason for revision..."
                    disabled={disabled}
                    data-testid={`textarea-factory-note-${invite.id}`}
                    {...field}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={disabled || mutation.isPending} data-testid={`button-factory-submit-${invite.id}`}>
              <Send className="mr-2 h-4 w-4" />
              Submit ETD
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={disabled || mutation.isPending}
              onClick={() => mutation.mutate({ action: "accept", note: "Factory accepted the ETD-only commitment." })}
              data-testid={`button-factory-accept-${invite.id}`}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Accept
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={disabled || mutation.isPending}
              onClick={() => mutation.mutate({ action: "decline", note: "Factory declined this ETD-only request." })}
              data-testid={`button-factory-decline-${invite.id}`}
            >
              <XCircle className="mr-2 h-4 w-4" />
              Decline
            </Button>
          </div>
          <p className="text-xs text-muted-foreground" data-testid={`text-factory-no-price-${invite.id}`}>
            Price is hidden for factory users. Only ETD and operational notes are negotiated here.
          </p>
        </form>
      </Form>
    </div>
  );
}

function BuyerControls({
  invite,
  rfqId,
  canAcceptOrAward,
  isCommercial,
  hasOpenRecommendation,
  workflowType,
  priceValidityMonths,
}: {
  invite: Invite;
  rfqId: number;
  canAcceptOrAward: boolean;
  isCommercial: boolean;
  hasOpenRecommendation: boolean;
  workflowType: WorkflowType;
  priceValidityMonths?: number | null;
}) {
  const priceVisible = invite.priceVisibility === "visible";
  const [closureReason, setClosureReason] = useState("");
  const form = useForm<z.infer<ReturnType<typeof responseSchema>>>({
    resolver: zodResolver(responseSchema(priceVisible)),
    defaultValues: {
      price: invite.currentPrice ?? undefined,
      etd: invite.currentEtd ?? "",
      note: "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (payload: { action: "counter" | "accept" | "decline"; price?: number; etd?: string; note: string }) => {
      const response = await apiRequest("POST", `/api/invites/${invite.id}/negotiations`, {
        ...payload,
        actor: "buyer",
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfqs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfqs", rfqId] });
      queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
      form.reset({ price: invite.currentPrice ?? undefined, etd: invite.currentEtd ?? "", note: "" });
    },
  });

  const award = useMutation({
    mutationFn: async (manualReason?: string) => {
      const body: { inviteId: number; closureReason?: string } = { inviteId: invite.id };
      if (manualReason && manualReason.trim()) body.closureReason = manualReason.trim();
      const response = await apiRequest("POST", `/api/rfqs/${rfqId}/award`, body);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfqs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfqs", rfqId] });
      queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
      setClosureReason("");
    },
  });

  const disabled =
    invite.status === "accepted" ||
    invite.status === "declined" ||
    invite.status === "closed" ||
    invite.status === "awarded";

  return (
    <div className="rounded-xl border bg-card/60 p-4">
      <Form {...form}>
        <form
          className="grid gap-3"
          onSubmit={form.handleSubmit((values) =>
            mutation.mutate({
              action: "counter",
              etd: values.etd,
              note: values.note,
              ...(priceVisible ? { price: values.price } : {}),
            }),
          )}
          data-testid={`form-buyer-counter-${invite.id}`}
        >
          <div className={`grid gap-3 ${priceVisible ? "sm:grid-cols-2" : ""}`}>
            {priceVisible && (
              <FormField
                control={form.control}
                name="price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Counter price (USD)</FormLabel>
                    <FormControl>
                      <Input type="number" min="1" disabled={disabled} aria-describedby={`hint-buyer-price-${invite.id}`} data-testid={`input-buyer-price-${invite.id}`} {...field} />
                    </FormControl>
                    <p id={`hint-buyer-price-${invite.id}`} className="text-xs text-muted-foreground">All TEG transactions are in USD.</p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="etd"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{priceVisible ? "Counter ETD" : "Requested revised ETD"}</FormLabel>
                  <FormControl>
                    <Input type="date" disabled={disabled} data-testid={`input-buyer-etd-${invite.id}`} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="note"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Message</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder={priceVisible ? "Ask for a revised price, earlier ETD, or clarification..." : "Ask the factory for an improved ETD or capacity confirmation..."}
                    disabled={disabled}
                    data-testid={`textarea-buyer-note-${invite.id}`}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={disabled || mutation.isPending} data-testid={`button-counter-${invite.id}`}>
              <Handshake className="mr-2 h-4 w-4" />
              {priceVisible ? "Send counter" : "Request revised ETD"}
            </Button>
            {canAcceptOrAward && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled || award.isPending}
                  onClick={() => award.mutate(closureReason)}
                  data-testid={`button-award-${invite.id}`}
                >
                  <Award className="mr-2 h-4 w-4" />
                  {workflowType === "price_validity_inquiry"
                    ? `Accept ${priceValidityMonths ?? 6}-month price validity`
                    : "Accept & award"}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={disabled || mutation.isPending}
                  onClick={() =>
                    mutation.mutate({
                      action: "decline",
                      note: priceVisible
                        ? "TEG declined this quotation."
                        : "TEG declined this internal ETD.",
                    })
                  }
                  data-testid={`button-decline-${invite.id}`}
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Decline
                </Button>
              </>
            )}
          </div>
          {canAcceptOrAward && !disabled && (
            <div className="grid gap-2 rounded-lg border border-dashed bg-muted/30 p-3">
              <Label
                htmlFor={`input-closure-reason-${invite.id}`}
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                Closure reason for non-winning recipients (optional)
              </Label>
              <Textarea
                id={`input-closure-reason-${invite.id}`}
                value={closureReason}
                onChange={(event) => setClosureReason(event.target.value)}
                placeholder="Defaults to: Closed automatically because RFQ was awarded to another recipient."
                data-testid={`input-closure-reason-${invite.id}`}
                className="min-h-[60px]"
              />
              <p className="text-xs text-muted-foreground">
                {workflowType === "price_validity_inquiry"
                  ? `Accepting this recipient records the ${priceValidityMonths ?? 6}-month price validity. Other invites on this inquiry are closed with the reason above; you can issue purchase orders later when stock is required.`
                  : "Awarding this recipient closes every other invite on this RFQ with this reason."}
              </p>
            </div>
          )}
          {!canAcceptOrAward && !isCommercial && (
            <p
              className="text-xs text-muted-foreground"
              data-testid={`text-commercial-no-accept-${invite.id}`}
            >
              You can negotiate but cannot accept, decline, or award. Hand off to
              Senior Management to close.
            </p>
          )}
          {!canAcceptOrAward && isCommercial && (
            <p
              className="text-xs text-muted-foreground"
              data-testid={`text-commercial-no-accept-${invite.id}`}
            >
              Commercial staff cannot accept, decline, or award. Use “Recommend for Senior Management approval” below to escalate this recipient as the proposed winner.
            </p>
          )}
          {!priceVisible && (
            <p className="text-xs text-muted-foreground" data-testid={`text-price-hidden-${invite.id}`}>
              Price is hidden for this recipient. Only ETD and operational notes are negotiated.
            </p>
          )}
        </form>
      </Form>
    </div>
  );
}

function Timeline({ negotiations, priceVisible }: { negotiations: Negotiation[]; priceVisible: boolean }) {
  if (!negotiations.length) {
    return <p className="text-sm text-muted-foreground">No activity yet. The response link is ready to send.</p>;
  }

  return (
    <ol className="space-y-3">
      {negotiations.map((entry) => (
        <li key={entry.id} className="rounded-lg border bg-background p-3" data-testid={`timeline-entry-${entry.id}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{entry.actor === "buyer" ? "Internal team" : entry.actor === "factory" ? "Factory" : "Subcontractor"}</Badge>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">{entry.action}</span>
            <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}</span>
          </div>
          <p className="mt-2 text-sm">{entry.note}</p>
          {(entry.price || entry.etd) && (
            <p className="mt-2 text-xs text-muted-foreground">
              {priceVisible && entry.price ? `Price: ${formatPrice(entry.price)}` : ""} {entry.etd ? `ETD: ${entry.etd}` : ""}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

// Maximum size for the PO + Pricing Quotation uploads in the create flow. Mirrors the
// server-side limit in insertRfqDocumentSchema (15MB). Helper copy surfaces this so
// commercial users know what to expect when picking large scanned PDFs.
const PRE_RFQ_DOC_MAX_BYTES = 15 * 1024 * 1024;

function formatPreRfqBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

// Reads a File and returns its base64 content (without the data: prefix). Used both
// for the PO extract endpoint and for attaching the file to the RFQ post-create.
export function readFileBase64Stripped(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") return reject(new Error("Unexpected file reader output"));
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

// Shared upload-box presentation. Click-to-pick + drag-and-drop. Used by both the
// Pricing Quotation and Purchase Order boxes inside ProductManufacturingPoFields.
function PreRfqUploadBox({
  testIdPrefix,
  title,
  description,
  accept,
  acceptLabel,
  busy,
  busyLabel,
  selectedFile,
  onPick,
  onClear,
  iconKind = "doc",
  children,
}: {
  testIdPrefix: string;
  title: string;
  description: string;
  accept: string;
  acceptLabel: string;
  busy?: boolean;
  busyLabel?: string;
  selectedFile: File | null;
  onPick: (file: File) => void;
  onClear: () => void;
  iconKind?: "doc" | "po";
  children?: React.ReactNode;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const Icon = iconKind === "po" ? UploadCloud : FileText;

  function tryPick(file: File | null | undefined) {
    if (!file) return;
    if (file.size > PRE_RFQ_DOC_MAX_BYTES) {
      setSizeError(
        `File too large (${formatPreRfqBytes(file.size)}). Max ${formatPreRfqBytes(PRE_RFQ_DOC_MAX_BYTES)}.`,
      );
      return;
    }
    setSizeError(null);
    onPick(file);
  }

  return (
    <div
      className="grid gap-2 rounded-xl border bg-card p-3"
      data-testid={`panel-${testIdPrefix}-box`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
            {title}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
        </div>
        {selectedFile && !busy && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => {
              setSizeError(null);
              onClear();
            }}
            data-testid={`button-${testIdPrefix}-clear`}
          >
            <X className="h-3.5 w-3.5 mr-1" aria-hidden="true" /> Remove
          </Button>
        )}
      </div>

      <label
        className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-3 py-4 text-center text-[12px] transition-colors cursor-pointer ${
          isDragging
            ? "border-primary bg-primary/10"
            : selectedFile
              ? "border-emerald-300 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/30"
              : "border-muted-foreground/30 hover:border-primary/60 hover:bg-muted/40"
        } ${busy ? "opacity-70 cursor-wait" : ""}`}
        data-testid={`label-${testIdPrefix}-dropzone`}
        data-dragging={isDragging ? "true" : "false"}
        data-has-file={selectedFile ? "true" : "false"}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (busy) return;
          const file = e.dataTransfer.files?.[0];
          tryPick(file);
        }}
      >
        <input
          type="file"
          accept={accept}
          className="hidden"
          data-testid={`input-${testIdPrefix}-file`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            tryPick(file);
            e.currentTarget.value = "";
          }}
          disabled={busy}
        />
        {busy ? (
          <span data-testid={`text-${testIdPrefix}-busy`}>{busyLabel ?? "Uploading…"}</span>
        ) : selectedFile ? (
          <>
            <span
              className="font-medium text-emerald-900 dark:text-emerald-200 break-all"
              data-testid={`text-${testIdPrefix}-filename`}
            >
              {selectedFile.name}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {formatPreRfqBytes(selectedFile.size)} · click or drag to replace
            </span>
          </>
        ) : (
          <>
            <Upload className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <span>
              <span className="font-medium text-primary">Click to upload</span> or drag &amp; drop
            </span>
            <span className="text-[11px] text-muted-foreground">
              {acceptLabel} · max {formatPreRfqBytes(PRE_RFQ_DOC_MAX_BYTES)}
            </span>
          </>
        )}
      </label>

      {sizeError && (
        <p
          className="text-[11px] text-rose-700 dark:text-rose-300"
          data-testid={`text-${testIdPrefix}-size-error`}
        >
          {sizeError}
        </p>
      )}

      {children}
    </div>
  );
}

// Product Manufacturing PO context fields. Shown in place of the legacy
// Project / Order / Scope inputs when the user has selected the
// manufacturing_subcontractor category. Captures Partner / Client, Country,
// and Customer Name as stated on the PO; also includes:
//   • A Pricing Quotation upload box (no extraction; held client-side then
//     attached after RFQ creation).
//   • A Purchase Order upload box that runs heuristic extraction server-side
//     and surfaces the detected values as suggestions the user can apply.
//
// Both boxes support click-to-upload + drag-and-drop. Files are lifted to the
// Home page so the post-create attach mutation can reach them.
function ProductManufacturingPoFields({
  form,
  partnerClients,
  companies,
  pricingQuoteFile,
  setPricingQuoteFile,
  poFile,
  setPoFile,
}: {
  form: UseFormReturn<any>;
  partnerClients: PartnerClient[];
  companies: Company[];
  pricingQuoteFile: File | null;
  setPricingQuoteFile: (f: File | null) => void;
  poFile: File | null;
  setPoFile: (f: File | null) => void;
}) {
  const requestingCompanyIdRaw = form.watch("requestingCompanyId") as string | undefined;
  const requestingCompany = companies.find((c) => String(c.id) === requestingCompanyIdRaw) ?? null;
  const cluster = requestingCompany?.clusterName ?? null;
  // Filter the master list by the requesting company's cluster. Empty cluster
  // (no company yet) shows the full list rather than blocking the picker.
  const filtered = cluster
    ? partnerClients.filter((p) => p.clusterName === cluster)
    : partnerClients;

  const [extracting, setExtracting] = useState(false);
  const [extractResult, setExtractResult] = useState<PoExtractResult | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);

  // Helper to resolve country when the user picks a partner from the master list.
  function pickPartner(name: string) {
    form.setValue("partnerClient", name, { shouldDirty: true });
    const match = filtered.find((p) => p.name === name);
    if (match && (!form.getValues("poCountry") || form.getValues("poCountry") === "")) {
      form.setValue("poCountry", match.country, { shouldDirty: true });
    }
  }

  async function runPoExtraction(file: File) {
    setExtracting(true);
    setExtractError(null);
    setExtractResult(null);
    try {
      const contentBase64 = await readFileBase64Stripped(file);
      const response = await apiRequest("POST", "/api/po-extract", {
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        contentBase64,
        clusterName: cluster ?? undefined,
      });
      const result = (await response.json()) as PoExtractResult;
      setExtractResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Extraction failed.";
      setExtractError(msg);
    } finally {
      setExtracting(false);
    }
  }

  function handlePoPick(file: File) {
    setPoFile(file);
    void runPoExtraction(file);
  }

  // Per-field apply: only writes the suggestion if it's non-null. Always overwrites
  // on user action so the user's intent is unambiguous (the previous behaviour silently
  // ignored extracted values when the field already had any text, which is what the
  // bug report flagged as "not being filled as expected").
  function applyField(key: "partnerClient" | "poCountry" | "poCustomerName") {
    if (!extractResult) return;
    const value = extractResult[key];
    if (!value) return;
    form.setValue(key, value, { shouldDirty: true, shouldValidate: true });
  }

  function applyAllExtracted() {
    if (!extractResult) return;
    if (extractResult.partnerClient) {
      form.setValue("partnerClient", extractResult.partnerClient, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
    if (extractResult.poCountry) {
      form.setValue("poCountry", extractResult.poCountry, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
    if (extractResult.poCustomerName) {
      form.setValue("poCustomerName", extractResult.poCustomerName, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }

  const partnerCurrent = form.watch("partnerClient") as string | undefined;
  const countryCurrent = form.watch("poCountry") as string | undefined;
  const customerCurrent = form.watch("poCustomerName") as string | undefined;

  function fieldDiffers(current: string | undefined, suggested: string | null): boolean {
    if (!suggested) return false;
    return (current ?? "").trim() !== suggested.trim();
  }

  const anyFieldDiffers =
    fieldDiffers(partnerCurrent, extractResult?.partnerClient ?? null) ||
    fieldDiffers(countryCurrent, extractResult?.poCountry ?? null) ||
    fieldDiffers(customerCurrent, extractResult?.poCustomerName ?? null);

  return (
    <div
      className="grid gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3"
      data-testid="panel-mfg-po-context"
    >
      <div>
        <p className="text-sm font-semibold">Purchase Order context</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Product Manufacturing RFQs are sent only after a PO is received. Capture the partner who
          issued the PO, the partner&rsquo;s country, and the customer named on the PO.
        </p>
      </div>

      {/* Pricing Quotation upload box — comes first per the workflow:
          commercial team prepares the quote, attaches it for senior management
          to review later. No extraction; held client-side until RFQ is created. */}
      <PreRfqUploadBox
        testIdPrefix="pricing-quote"
        title="Pricing Quotation"
        description="Attach the pricing quotation used to brief Senior Management. Held until RFQ is created, then attached as a confidential reference document."
        accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.xls,.xlsx,.doc,.docx,application/pdf,image/*,text/plain,text/csv"
        acceptLabel="PDF, image, Office, text"
        selectedFile={pricingQuoteFile}
        onPick={(file) => setPricingQuoteFile(file)}
        onClear={() => setPricingQuoteFile(null)}
        iconKind="doc"
      />

      {/* Purchase Order upload box. Runs server-side extraction + surfaces a
          suggestion card with Apply all + per-field apply buttons. */}
      <PreRfqUploadBox
        testIdPrefix="po-upload"
        title="Purchase Order"
        description="Upload the customer PO. We extract the partner, country, and customer name automatically — review the suggestions before creating the RFQ."
        accept=".pdf,.txt,.csv,.md,application/pdf,text/plain"
        acceptLabel="PDF or text"
        busy={extracting}
        busyLabel="Extracting…"
        selectedFile={poFile}
        onPick={handlePoPick}
        onClear={() => {
          setPoFile(null);
          setExtractResult(null);
          setExtractError(null);
        }}
        iconKind="po"
      >
        {extractResult && (
          <div
            className="rounded-lg border bg-background p-2 text-[11px]"
            data-testid="panel-po-extract-result"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">
                Extraction confidence:{" "}
                <span data-testid="text-po-confidence">{extractResult.confidence}</span>
              </p>
              {anyFieldDiffers && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  onClick={applyAllExtracted}
                  data-testid="button-po-apply-all"
                >
                  Apply all extracted values
                </Button>
              )}
            </div>
            {extractResult.matchedLabels.length > 0 && (
              <p className="mt-1 text-muted-foreground">
                Matched labels: {extractResult.matchedLabels.join(", ")}
              </p>
            )}
            {extractResult.notes.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                {extractResult.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            )}
            {extractResult.textExtractionFailed && (
              <p
                className="mt-1 text-amber-700 dark:text-amber-300"
                data-testid="text-po-extract-manual-needed"
              >
                Could not read text from this PO (likely a scanned image). Please fill the fields
                manually below — the file will still be attached to the RFQ.
              </p>
            )}

            {/* Suggestion rows */}
            <div className="mt-2 grid gap-1">
              {(["partnerClient", "poCountry", "poCustomerName"] as const).map((key) => {
                const suggested = extractResult[key];
                if (!suggested) return null;
                const current =
                  key === "partnerClient"
                    ? partnerCurrent
                    : key === "poCountry"
                      ? countryCurrent
                      : customerCurrent;
                const differs = fieldDiffers(current, suggested);
                const label =
                  key === "partnerClient"
                    ? "Partner / Client"
                    : key === "poCountry"
                      ? "Country"
                      : "Customer name";
                return (
                  <div
                    key={key}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1"
                    data-testid={`row-po-suggestion-${key}`}
                  >
                    <div className="min-w-0">
                      <span className="text-muted-foreground">{label}:</span>{" "}
                      <span className="font-medium break-all">{suggested}</span>
                    </div>
                    {differs ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => applyField(key)}
                        data-testid={`button-po-apply-${key}`}
                      >
                        Apply
                      </Button>
                    ) : (
                      <span className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                        Applied
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-1 text-muted-foreground">
              The PO file will be attached to the RFQ after creation as an admin-only reference
              document. Factories and vendors never see it.
            </p>
          </div>
        )}
        {extractError && (
          <p
            className="text-xs text-rose-700 dark:text-rose-300"
            data-testid="text-po-extract-error"
          >
            {extractError}
          </p>
        )}
      </PreRfqUploadBox>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="partnerClient"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Partner / Client</FormLabel>
              {filtered.length > 0 && (
                // The Select is intentionally uncontrolled when the typed/extracted
                // partnerClient does not match a seeded entry — a previous controlled
                // setup with a synthetic "__custom__" sentinel caused Radix Select to
                // fire onValueChange("") for unknown values, which silently wiped the
                // partnerClient field after extraction or direct typing. Now we read
                // the value from RHF only when it matches a real SelectItem; otherwise
                // the Select trigger shows its placeholder and the typed Input below
                // is the source of truth.
                <Select
                  value={
                    filtered.find((p) => p.name === field.value)?.name ?? undefined
                  }
                  onValueChange={(v) => pickPartner(v)}
                >
                  <SelectTrigger data-testid="select-partner-client">
                    <SelectValue placeholder="Pick a partner from the list" />
                  </SelectTrigger>
                  <SelectContent>
                    {filtered.map((partner) => (
                      <SelectItem key={partner.id} value={partner.name}>
                        {partner.name}{" "}
                        <span className="text-muted-foreground">· {partner.country}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <FormControl>
                <Input
                  placeholder={
                    cluster
                      ? "Or type a partner not yet in the list"
                      : "Type the partner / client name"
                  }
                  data-testid="input-partner-client"
                  {...field}
                />
              </FormControl>
              {cluster && (
                <p className="text-[11px] text-muted-foreground">
                  Showing partners for {cluster}. Type any other name to create one ad-hoc.
                </p>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="poCountry"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Country</FormLabel>
              <FormControl>
                <Input
                  placeholder="e.g. Germany, Netherlands, United States"
                  data-testid="input-po-country"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name="poCustomerName"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Customer name (as stated on PO)</FormLabel>
            <FormControl>
              <Input
                placeholder="End-customer named on the PO. May differ from the partner."
                data-testid="input-po-customer-name"
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

// 'Products in this RFQ' editor for the create form. Shown only on the manufacturing
// category. Required: at least one product line. Each line carries productType,
// materialSpecification, productSize/weight, ecLevel, quantity, loadability per container.
function ProductLinesField({
  form,
  isExternal,
}: {
  form: UseFormReturn<any>;
  isExternal: boolean;
}) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "productLines",
  });
  // Watch the array for product-type-driven label/help text.
  const productLinesValue = form.watch("productLines") as Array<{ productType?: string }> | undefined;
  return (
    <div
      className="grid gap-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 text-xs dark:border-emerald-900 dark:bg-emerald-950/30"
      data-testid="panel-product-lines"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
            Products in this RFQ
          </p>
          <p className="mt-1 text-emerald-900/80 dark:text-emerald-200/80">
            {isExternal
              ? "Capture every product you want subcontractors to quote on. Add a product line per item — you can mix product types in one RFQ."
              : "Capture every product you want this internal / intercompany factory to confirm. Each line carries its own type, size, and loadability."}
          </p>
        </div>
      </div>
      {fields.length === 0 && (
        <div className="rounded-md border border-dashed bg-card/40 p-3 text-emerald-900/80 dark:text-emerald-200/80">
          No product lines yet. Click “Add product” below to start.
        </div>
      )}
      {fields.map((row, idx) => {
        const ptKey = (productLinesValue?.[idx]?.productType ?? "") as ManufacturingProductType | "";
        const ptMeta = ptKey ? MANUFACTURING_PRODUCT_TYPE_META[ptKey as ManufacturingProductType] : null;
        const sizeLabel = ptMeta?.sizeLabel ?? "Product size";
        const sizePlaceholder = ptMeta?.placeholder ?? "e.g. 40 x 20 x 10 cm";
        const sizeHelp = ptMeta?.sizeHelp ?? "Bag/pot dimensions or unit weight (for bales/blocks/baggers).";
        return (
          <div
            key={row.id}
            className="grid gap-3 rounded-lg border bg-card p-3"
            data-testid={`row-product-line-${idx}`}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">
                Product {idx + 1}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => remove(idx)}
                disabled={fields.length <= 1}
                data-testid={`button-remove-product-line-${idx}`}
                aria-label="Remove product line"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name={`productLines.${idx}.productType` as const}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product type</FormLabel>
                    <Select value={field.value || ""} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid={`select-product-line-type-${idx}`}>
                          <SelectValue placeholder="Select product type…" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {MANUFACTURING_PRODUCT_TYPES.map((pt) => (
                          <SelectItem key={pt} value={pt}>
                            {MANUFACTURING_PRODUCT_TYPE_META[pt].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {ptMeta && (
                      <p className="text-[11px] text-emerald-900/70 dark:text-emerald-200/70">{ptMeta.sizeHelp}</p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={`productLines.${idx}.${"materialSpecification" as const}` as const}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Material specification</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        placeholder="e.g. coir + perlite mix, 70:30"
                        data-testid={`input-product-line-material-${idx}`}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name={`productLines.${idx}.productSize` as const}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{sizeLabel}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={sizePlaceholder}
                        data-testid={`input-product-line-size-${idx}`}
                        {...field}
                      />
                    </FormControl>
                    <p className="text-[11px] text-muted-foreground">{sizeHelp}</p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={`productLines.${idx}.ecLevel` as const}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>EC level</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. EC < 0.5 mS/cm"
                        data-testid={`input-product-line-ec-${idx}`}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name={`productLines.${idx}.quantity` as const}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantity</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. 6 containers, 15,000 bags"
                        data-testid={`input-product-line-quantity-${idx}`}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={`productLines.${idx}.loadabilityPerContainer` as const}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Loadability per container</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. 2,800 bags / 20ft container"
                        data-testid={`input-product-line-loadability-${idx}`}
                        {...field}
                      />
                    </FormControl>
                    <p className="text-[11px] text-muted-foreground">Units per container for export.</p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name={`productLines.${idx}.notes` as const}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Anything else this product line needs…"
                      data-testid={`input-product-line-notes-${idx}`}
                      {...field}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            append({
              productType: "",
              materialSpecification: "",
              productSize: "",
              ecLevel: "",
              quantity: "",
              loadabilityPerContainer: "",
              notes: "",
            })
          }
          data-testid="button-add-product-line"
        >
          <Plus className="mr-2 h-4 w-4" /> Add product
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Add more rows when this RFQ covers multiple products. Each line is quoted independently.
        </p>
      </div>
    </div>
  );
}

// NOTE: production splits are no longer collected on the create form. They are added
// per-product-line via the Edit RFQ panel after the RFQ is created. The legacy
// SplitsField + RFQ-level split UI was removed in the product-line splits change.

// Per-product-line production split editor. Lives inside each product card in the Edit
// panel. Toggle on → seed two empty rows. Toggle off → splits are cleared. When at
// least 2 valid rows are present, they are sent on save as productLine.productionSplits.
function ProductLineSplitsEditor({
  index,
  splits,
  onChange,
}: {
  index: number;
  splits: ProductionSplitRow[] | null;
  onChange: (next: ProductionSplitRow[] | null) => void;
}) {
  const enabled = Array.isArray(splits) && splits.length > 0;
  const rows = enabled ? splits! : [];
  const setRows = (next: ProductionSplitRow[]) => onChange(next.length > 0 ? next : null);
  return (
    <div
      className="mt-1 grid gap-2 rounded-lg border border-sky-200 bg-sky-50/40 p-3 dark:border-sky-900 dark:bg-sky-950/30"
      data-testid={`panel-edit-product-line-splits-${index}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold text-sky-900 dark:text-sky-200">
            <Split className="h-4 w-4" /> Split this product across locations?
          </p>
          <p className="mt-1 text-[11px] leading-snug text-sky-900/80 dark:text-sky-200/80">
            Optional — turn on if this product is produced at more than one factory or subcontractor. Add at least 2 rows.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => {
            if (v) {
              onChange([
                { locationName: "", allocation: "", note: null },
                { locationName: "", allocation: "", note: null },
              ]);
            } else {
              onChange(null);
            }
          }}
          data-testid={`switch-edit-product-line-split-enabled-${index}`}
        />
      </div>
      {enabled && (
        <div className="grid gap-2">
          {rows.map((row, ridx) => (
            <div
              key={ridx}
              className="grid gap-2 rounded-lg border bg-card p-2 sm:grid-cols-[1fr_140px_1fr_auto] sm:items-start"
              data-testid={`row-edit-product-line-split-${index}-${ridx}`}
            >
              <div>
                <Label>Location / vendor</Label>
                <Input
                  value={row.locationName}
                  placeholder="e.g. Tropicoir Lanka — Mirigama"
                  onChange={(e) => {
                    const next = [...rows];
                    next[ridx] = { ...row, locationName: e.target.value };
                    setRows(next);
                  }}
                  data-testid={`input-edit-product-line-split-location-${index}-${ridx}`}
                />
              </div>
              <div>
                <Label>Allocation</Label>
                <Input
                  value={row.allocation}
                  placeholder="60% / 100u"
                  onChange={(e) => {
                    const next = [...rows];
                    next[ridx] = { ...row, allocation: e.target.value };
                    setRows(next);
                  }}
                  data-testid={`input-edit-product-line-split-allocation-${index}-${ridx}`}
                />
              </div>
              <div>
                <Label>Note</Label>
                <Input
                  value={row.note ?? ""}
                  placeholder="Optional"
                  onChange={(e) => {
                    const next = [...rows];
                    next[ridx] = { ...row, note: e.target.value || null };
                    setRows(next);
                  }}
                  data-testid={`input-edit-product-line-split-note-${index}-${ridx}`}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mt-6"
                disabled={rows.length <= 2}
                onClick={() => setRows(rows.filter((_, i) => i !== ridx))}
                data-testid={`button-edit-product-line-split-remove-${index}-${ridx}`}
                aria-label="Remove split row"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRows([...rows, { locationName: "", allocation: "", note: null }])}
              data-testid={`button-edit-product-line-split-add-${index}`}
            >
              <Plus className="mr-2 h-4 w-4" /> Add another location
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Use percentages (e.g. “60%” + “40%”) or absolute units — whatever is clearest for recipients.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function EditRfqPanel({
  rfq,
  hasInvites,
  isPending,
  onCancel,
  onSubmit,
}: {
  rfq: Rfq;
  hasInvites: boolean;
  isPending: boolean;
  onCancel: () => void;
  onSubmit: (patch: Record<string, unknown>) => void;
}) {
  const parsedSpecs: any = (() => {
    try { return JSON.parse(rfq.materialSpecs ?? "{}") || {}; } catch { return {}; }
  })();
  const initialPolybag = parsedSpecs.marketedSize && parsedSpecs.actualSize
    ? {
        ml: parsedSpecs.marketedSize.length ?? "", mw: parsedSpecs.marketedSize.width ?? "", mh: parsedSpecs.marketedSize.height ?? "",
        al: parsedSpecs.actualSize.length ?? "", aw: parsedSpecs.actualSize.width ?? "", ah: parsedSpecs.actualSize.height ?? "",
        gauge: parsedSpecs.gauge ?? "", etdRequired: parsedSpecs.etdRequired ?? "",
      }
    : null;
  const initialMfg = parsedSpecs.manufacturing ?? null;
  // Initial product lines: use parsedSpecs.productLines when present; otherwise
  // synthesize one line from legacy `manufacturing` + rfq-level quantity/unit so the
  // editor can show something the user recognizes.
  // Read legacy RFQ-level splits so we can migrate them onto product line 1 when there
  // are no per-line splits already attached.
  const legacyRfqSplits: ProductionSplitRow[] = Array.isArray(parsedSpecs.productionSplits)
    ? (parsedSpecs.productionSplits as ProductionSplitRow[]).filter(
        (r) => r && typeof r === "object" && r.locationName && r.allocation,
      )
    : [];
  const initialProductLines: ProductLine[] = (() => {
    const arr = parsedSpecs.productLines;
    if (Array.isArray(arr)) {
      const lines: ProductLine[] = arr
        .filter(
          (l: any) =>
            l && typeof l === "object" &&
            (MANUFACTURING_PRODUCT_TYPES as readonly string[]).includes(l.productType) &&
            l.materialSpecification && l.productSize && l.ecLevel && l.quantity && l.loadabilityPerContainer,
        )
        .map((l: any) => {
          // Per-line splits already saved on this product line.
          let lineSplits: ProductionSplitRow[] | null = null;
          if (Array.isArray(l.productionSplits)) {
            const cleaned = (l.productionSplits as ProductionSplitRow[]).filter(
              (r) => r && typeof r === "object" && r.locationName && r.allocation,
            );
            if (cleaned.length >= 2) lineSplits = cleaned;
          }
          return {
            productType: l.productType,
            materialSpecification: l.materialSpecification,
            productSize: l.productSize,
            ecLevel: l.ecLevel,
            quantity: l.quantity,
            loadabilityPerContainer: l.loadabilityPerContainer,
            notes: typeof l.notes === "string" ? l.notes : null,
            productionSplits: lineSplits,
          };
        });
      // Legacy migration: if no per-line splits exist anywhere but an RFQ-level split
      // does, attach it to the first product line so the user can continue to manage it.
      const anyLineHasSplit = lines.some(
        (l) => Array.isArray(l.productionSplits) && (l.productionSplits as ProductionSplitRow[]).length >= 2,
      );
      if (!anyLineHasSplit && legacyRfqSplits.length >= 2 && lines.length > 0) {
        lines[0] = { ...lines[0], productionSplits: legacyRfqSplits };
      }
      return lines;
    }
    if (initialMfg && typeof initialMfg === "object" && initialMfg.materialSpecification && initialMfg.productSize && initialMfg.ecLevel) {
      const pt = (MANUFACTURING_PRODUCT_TYPES as readonly string[]).includes(initialMfg.productType)
        ? (initialMfg.productType as ManufacturingProductType)
        : ("growbags" as ManufacturingProductType);
      return [
        {
          productType: pt,
          materialSpecification: initialMfg.materialSpecification,
          productSize: initialMfg.productSize,
          ecLevel: initialMfg.ecLevel,
          quantity: rfq.quantity || "",
          loadabilityPerContainer: rfq.unit || "",
          notes: null,
          productionSplits: legacyRfqSplits.length >= 2 ? legacyRfqSplits : null,
        },
      ];
    }
    return [];
  })();

  const [projectName, setProjectName] = useState(rfq.projectName);
  const [packageName, setPackageName] = useState(rfq.packageName);
  const [description, setDescription] = useState(rfq.description);
  // Product Manufacturing PO context. May be null on legacy rows; the panel still
  // lets users add the values even if invites already exist (it's commercial context,
  // not routing) so recipients are notified about the change.
  const [partnerClient, setPartnerClient] = useState(rfq.partnerClient ?? "");
  const [poCountry, setPoCountry] = useState(rfq.poCountry ?? "");
  const [poCustomerName, setPoCustomerName] = useState(rfq.poCustomerName ?? "");
  const [quantity, setQuantity] = useState(rfq.quantity);
  const [unit, setUnit] = useState(rfq.unit);
  const [targetEtd, setTargetEtd] = useState(rfq.targetEtd);
  const [responseDue, setResponseDue] = useState(rfq.responseDue);
  const [requestType, setRequestType] = useState(rfq.requestType);
  const [category, setCategory] = useState<RfqCategory>(rfq.category);
  const [polybag, setPolybag] = useState<{ ml: string; mw: string; mh: string; al: string; aw: string; ah: string; gauge: string; etdRequired: string }>(
    initialPolybag ?? { ml: "", mw: "", mh: "", al: "", aw: "", ah: "", gauge: "", etdRequired: "" },
  );
  const [mfg, setMfg] = useState<{
    materialSpecification: string;
    productSize: string;
    ecLevel: string;
    productType: ManufacturingProductType | "";
  }>(
    initialMfg
      ? {
          materialSpecification: initialMfg.materialSpecification ?? "",
          productSize: initialMfg.productSize ?? "",
          ecLevel: initialMfg.ecLevel ?? "",
          productType: ((MANUFACTURING_PRODUCT_TYPES as readonly string[]).includes(initialMfg.productType)
            ? (initialMfg.productType as ManufacturingProductType)
            : "") as ManufacturingProductType | "",
        }
      : { materialSpecification: "", productSize: "", ecLevel: "", productType: "" },
  );
  // Editable product lines for this RFQ. Initialised from parsed materialSpecs.
  // For non-manufacturing RFQs this stays empty and the panel hides the section.
  // Each product line carries its own optional productionSplits array (>=2 rows).
  const [productLines, setProductLines] = useState<ProductLine[]>(
    initialProductLines.length > 0
      ? initialProductLines
      : [
          {
            productType: "growbags",
            materialSpecification: "",
            productSize: "",
            ecLevel: "",
            quantity: "",
            loadabilityPerContainer: "",
            notes: null,
            productionSplits: null,
          },
        ],
  );
  // Optional amendment reason. Captured here, sent on PATCH, recorded on the
  // amendment row only. Never leaves the internal API — portal users see only
  // the safe summary the server synthesises from changedFields.
  const [amendmentReason, setAmendmentReason] = useState<string>("");

  const isPolybag = category === "polythene_bags";
  const isExternalMfg = requestType === "external_rfq" && category === "manufacturing_subcontractor";
  const isMfgCategory = category === "manufacturing_subcontractor";
  const lockedToMfg = requestType === "internal_etd" || requestType === "intercompany";
  const mfgMeta = mfg.productType
    ? MANUFACTURING_PRODUCT_TYPE_META[mfg.productType as ManufacturingProductType]
    : null;
  const productSizeLabel = mfgMeta?.sizeLabel ?? "Product size";

  // Internal/intercompany should auto-snap category to manufacturing.
  useEffect(() => {
    if (lockedToMfg && category !== "manufacturing_subcontractor") setCategory("manufacturing_subcontractor");
  }, [lockedToMfg, category]);
  // Inverse: a non-manufacturing category forces external_rfq when the user is allowed to
  // change requestType (no invites yet).
  useEffect(() => {
    if (!hasInvites && !isMfgCategory && requestType !== "external_rfq") {
      setRequestType("external_rfq");
    }
  }, [hasInvites, isMfgCategory, requestType]);

  function submit() {
    const patch: Record<string, unknown> = {
      projectName,
      packageName,
      description,
      quantity,
      unit,
      targetEtd,
      responseDue,
      // Optional amendment reason — only included when the user typed something.
      ...(amendmentReason.trim() ? { amendmentReason: amendmentReason.trim() } : {}),
    };
    if (isMfgCategory) {
      // Product Manufacturing PO context. Send each value when the user has touched it;
      // the server only emits a changed-field notification when the value differs.
      patch.partnerClient = partnerClient.trim() || null;
      patch.poCountry = poCountry.trim() || null;
      patch.poCustomerName = poCustomerName.trim() || null;
    }
    if (!hasInvites) {
      patch.requestType = requestType;
      patch.category = category;
    }
    if (isPolybag) {
      patch.polybagSpecs = {
        marketedSize: { length: polybag.ml, width: polybag.mw, height: polybag.mh },
        actualSize: { length: polybag.al, width: polybag.aw, height: polybag.ah },
        gauge: polybag.gauge,
        etdRequired: polybag.etdRequired,
      };
    }
    if (isMfgCategory) {
      // Send productLines (multi-product). Filter out blank rows; require 1+ valid line.
      // Each line may carry an optional productionSplits array of >=2 rows.
      const cleanedLines = productLines
        .filter(
          (l) =>
            l.productType &&
            l.materialSpecification?.trim() &&
            l.productSize?.trim() &&
            l.ecLevel?.trim() &&
            l.quantity?.trim() &&
            l.loadabilityPerContainer?.trim(),
        )
        .map((l) => {
          let cleanedSplits: ProductionSplitRow[] | null = null;
          if (Array.isArray(l.productionSplits) && l.productionSplits.length > 0) {
            const ok = (l.productionSplits as ProductionSplitRow[])
              .filter((r) => r.locationName.trim() && r.allocation.trim())
              .map((r) => ({
                locationName: r.locationName.trim(),
                allocation: r.allocation.trim(),
                note: r.note?.trim() ? r.note.trim() : null,
              }));
            cleanedSplits = ok.length >= 2 ? ok : null;
          }
          return {
            productType: l.productType,
            materialSpecification: l.materialSpecification.trim(),
            productSize: l.productSize.trim(),
            ecLevel: l.ecLevel.trim(),
            quantity: l.quantity.trim(),
            loadabilityPerContainer: l.loadabilityPerContainer.trim(),
            notes: l.notes?.trim() ? l.notes.trim() : null,
            productionSplits: cleanedSplits,
          };
        });
      if (cleanedLines.length > 0) {
        patch.productLines = cleanedLines;
        // Keep top-level quantity/unit aggregate in sync.
        patch.quantity = cleanedLines.length > 1 ? "Multiple products" : cleanedLines[0].quantity;
        patch.unit = cleanedLines.length > 1 ? "see product lines" : cleanedLines[0].loadabilityPerContainer;
      }
      // Clear any legacy RFQ-level split when saving from this panel — splits now live
      // on each product line. The first line absorbed the legacy rows on open if the
      // user did not edit them away.
      if (legacyRfqSplits.length > 0) {
        patch.productionSplits = null;
      }
    }
    onSubmit(patch);
  }

  return (
    <div
      className="grid gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4"
      data-testid="panel-edit-rfq"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Edit RFQ {rfq.reference}</p>
        <p className="text-[11px] text-muted-foreground">
          {hasInvites
            ? "Recipients have been invited — you cannot change request type or section."
            : "No invites sent yet — you can change request type and section freely."}
        </p>
      </div>
      <div
        className="rounded-lg border bg-card p-3"
        data-testid="panel-edit-request-type"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Request type</p>
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          {REQUEST_TYPE_OPTIONS.map((opt) => {
            const selected = requestType === opt.value;
            const restrictedToMfg = opt.value !== "external_rfq" && !isMfgCategory;
            const disabled = hasInvites || restrictedToMfg;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={disabled}
                onClick={() => !disabled && setRequestType(opt.value)}
                title={restrictedToMfg ? "Available only for Product Manufacturing" : undefined}
                className={`rounded-lg border p-3 text-left transition ${
                  selected
                    ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                    : restrictedToMfg
                      ? "cursor-not-allowed border-dashed bg-muted/30 opacity-60"
                      : "bg-background"
                } ${hasInvites ? "opacity-60" : !restrictedToMfg ? "hover:border-primary/60" : ""}`}
                data-testid={`radio-edit-request-type-${opt.value}`}
              >
                <p className="text-sm font-semibold">{opt.title}</p>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{opt.description}</p>
                {restrictedToMfg && (
                  <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
                    Manufacturing only
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Section / category</Label>
          <Select
            value={category}
            onValueChange={(v) => setCategory(v as RfqCategory)}
            disabled={hasInvites || lockedToMfg}
          >
            <SelectTrigger data-testid="select-edit-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RFQ_CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>{RFQ_CATEGORY_META[cat].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!isMfgCategory && (
          <>
            <div>
              <Label>Project</Label>
              <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} data-testid="input-edit-project" />
            </div>
            <div>
              <Label>Package / order</Label>
              <Input value={packageName} onChange={(e) => setPackageName(e.target.value)} data-testid="input-edit-package" />
            </div>
            <div>
              <Label>Quantity</Label>
              <Input value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="input-edit-quantity" />
            </div>
            <div>
              <Label>Unit</Label>
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} data-testid="input-edit-unit" />
            </div>
          </>
        )}
        {isMfgCategory && (
          <>
            <div>
              <Label>Partner / Client</Label>
              <Input
                value={partnerClient}
                onChange={(e) => setPartnerClient(e.target.value)}
                placeholder="Partner who issued the PO"
                data-testid="input-edit-partner-client"
              />
            </div>
            <div>
              <Label>Country</Label>
              <Input
                value={poCountry}
                onChange={(e) => setPoCountry(e.target.value)}
                placeholder="e.g. Germany"
                data-testid="input-edit-po-country"
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Customer name (as stated on PO)</Label>
              <Input
                value={poCustomerName}
                onChange={(e) => setPoCustomerName(e.target.value)}
                placeholder="End-customer named on the PO"
                data-testid="input-edit-po-customer-name"
              />
            </div>
          </>
        )}
        <div>
          <Label>Target ETD</Label>
          <Input type="date" value={targetEtd} onChange={(e) => setTargetEtd(e.target.value)} data-testid="input-edit-target-etd" />
        </div>
        <div>
          <Label>Response due</Label>
          <Input type="date" value={responseDue} onChange={(e) => setResponseDue(e.target.value)} data-testid="input-edit-response-due" />
        </div>
      </div>
      {!isMfgCategory && (
        <div>
          <Label>Scope description</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} data-testid="textarea-edit-description" />
        </div>
      )}

      {isPolybag && (
        <div className="grid gap-2 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 text-xs dark:border-indigo-900 dark:bg-indigo-950/30">
          <p className="text-sm font-semibold">Polybag specs</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <div><Label>Marketed L</Label><Input value={polybag.ml} onChange={(e) => setPolybag({ ...polybag, ml: e.target.value })} data-testid="input-edit-polybag-marketed-length" /></div>
            <div><Label>Marketed W</Label><Input value={polybag.mw} onChange={(e) => setPolybag({ ...polybag, mw: e.target.value })} data-testid="input-edit-polybag-marketed-width" /></div>
            <div><Label>Marketed H</Label><Input value={polybag.mh} onChange={(e) => setPolybag({ ...polybag, mh: e.target.value })} data-testid="input-edit-polybag-marketed-height" /></div>
            <div><Label>Actual L</Label><Input value={polybag.al} onChange={(e) => setPolybag({ ...polybag, al: e.target.value })} data-testid="input-edit-polybag-actual-length" /></div>
            <div><Label>Actual W</Label><Input value={polybag.aw} onChange={(e) => setPolybag({ ...polybag, aw: e.target.value })} data-testid="input-edit-polybag-actual-width" /></div>
            <div><Label>Actual H</Label><Input value={polybag.ah} onChange={(e) => setPolybag({ ...polybag, ah: e.target.value })} data-testid="input-edit-polybag-actual-height" /></div>
            <div><Label>Gauge</Label><Input value={polybag.gauge} onChange={(e) => setPolybag({ ...polybag, gauge: e.target.value })} data-testid="input-edit-polybag-gauge" /></div>
            <div className="sm:col-span-2"><Label>ETD required</Label><Input type="date" value={polybag.etdRequired} onChange={(e) => setPolybag({ ...polybag, etdRequired: e.target.value })} data-testid="input-edit-polybag-etd-required" /></div>
          </div>
        </div>
      )}

      {isMfgCategory && (
        <div
          className="grid gap-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 text-xs dark:border-emerald-900 dark:bg-emerald-950/30"
          data-testid="panel-edit-product-lines"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Products in this RFQ</p>
            <p className="text-[11px] text-muted-foreground">
              Add or remove product lines as needed. Sending updates after invites are out triggers an RFQ-updated notification.
            </p>
          </div>
          {productLines.map((line, idx) => {
            const ptMeta = (MANUFACTURING_PRODUCT_TYPES as readonly string[]).includes(line.productType)
              ? MANUFACTURING_PRODUCT_TYPE_META[line.productType as ManufacturingProductType]
              : null;
            const sizeLabel = ptMeta?.sizeLabel ?? "Product size";
            const sizePlaceholder = ptMeta?.placeholder ?? "e.g. 40 x 20 x 10 cm";
            const updateLine = (patch: Partial<ProductLine>) => {
              setProductLines((prev) => {
                const next = [...prev];
                next[idx] = { ...prev[idx], ...patch };
                return next;
              });
            };
            return (
              <div
                key={idx}
                className="grid gap-2 rounded-lg border bg-card p-3"
                data-testid={`row-edit-product-line-${idx}`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Product {idx + 1}</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setProductLines((prev) => prev.filter((_, i) => i !== idx))}
                    disabled={productLines.length <= 1}
                    data-testid={`button-edit-remove-product-line-${idx}`}
                    aria-label="Remove product line"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label>Product type</Label>
                    <Select
                      value={line.productType || ""}
                      onValueChange={(v) => updateLine({ productType: v as ManufacturingProductType })}
                    >
                      <SelectTrigger data-testid={`select-edit-product-line-type-${idx}`}>
                        <SelectValue placeholder="Select product type…" />
                      </SelectTrigger>
                      <SelectContent>
                        {MANUFACTURING_PRODUCT_TYPES.map((pt) => (
                          <SelectItem key={pt} value={pt}>{MANUFACTURING_PRODUCT_TYPE_META[pt].label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {ptMeta && (
                      <p className="mt-1 text-[11px] text-muted-foreground">{ptMeta.sizeHelp}</p>
                    )}
                  </div>
                  <div>
                    <Label>Material specification</Label>
                    <Textarea
                      rows={2}
                      value={line.materialSpecification}
                      onChange={(e) => updateLine({ materialSpecification: e.target.value })}
                      data-testid={`input-edit-product-line-material-${idx}`}
                    />
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label>{sizeLabel}</Label>
                    <Input
                      placeholder={sizePlaceholder}
                      value={line.productSize}
                      onChange={(e) => updateLine({ productSize: e.target.value })}
                      data-testid={`input-edit-product-line-size-${idx}`}
                    />
                  </div>
                  <div>
                    <Label>EC level</Label>
                    <Input
                      value={line.ecLevel}
                      onChange={(e) => updateLine({ ecLevel: e.target.value })}
                      data-testid={`input-edit-product-line-ec-${idx}`}
                    />
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label>Quantity</Label>
                    <Input
                      placeholder="e.g. 6 containers, 15,000 bags"
                      value={line.quantity}
                      onChange={(e) => updateLine({ quantity: e.target.value })}
                      data-testid={`input-edit-product-line-quantity-${idx}`}
                    />
                  </div>
                  <div>
                    <Label>Loadability per container</Label>
                    <Input
                      placeholder="e.g. 2,800 bags / 20ft container"
                      value={line.loadabilityPerContainer}
                      onChange={(e) => updateLine({ loadabilityPerContainer: e.target.value })}
                      data-testid={`input-edit-product-line-loadability-${idx}`}
                    />
                  </div>
                </div>
                <div>
                  <Label>Notes (optional)</Label>
                  <Input
                    value={line.notes ?? ""}
                    onChange={(e) => updateLine({ notes: e.target.value || null })}
                    data-testid={`input-edit-product-line-notes-${idx}`}
                  />
                </div>
                {/* Per-product-line production split editor. Splits live on the product
                    line, not the RFQ — different products may have different splits. */}
                <ProductLineSplitsEditor
                  index={idx}
                  splits={Array.isArray(line.productionSplits) ? line.productionSplits : null}
                  onChange={(next) => updateLine({ productionSplits: next })}
                />
              </div>
            );
          })}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setProductLines((prev) => [
                  ...prev,
                  {
                    productType: "growbags",
                    materialSpecification: "",
                    productSize: "",
                    ecLevel: "",
                    quantity: "",
                    loadabilityPerContainer: "",
                    notes: null,
                    productionSplits: null,
                  },
                ])
              }
              data-testid="button-edit-add-product-line"
            >
              <Plus className="mr-2 h-4 w-4" /> Add product
            </Button>
          </div>
        </div>
      )}

      {/* RFQ-level split panel removed — splits now live inside each product line.
          Legacy RFQ-level splits, when present on an existing RFQ, are migrated onto
          product line 1 on open so the user can edit them in the per-line UI above. */}
      {isMfgCategory && legacyRfqSplits.length >= 2 && (
        <p
          className="text-[11px] text-muted-foreground"
          data-testid="text-edit-legacy-split-migrated"
        >
          Legacy RFQ-level production split was attached to product 1. Edit or remove it from product 1 above.
        </p>
      )}

      {/* Optional amendment reason. Captured here, written to the amendment row
          and shown only to internal roles. Portal recipients see a safe summary. */}
      <div className="rounded-lg border bg-card p-3" data-testid="panel-edit-amendment-reason">
        <Label htmlFor="input-amendment-reason">
          Reason for this revision <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="input-amendment-reason"
          value={amendmentReason}
          onChange={(e) => setAmendmentReason(e.target.value)}
          rows={2}
          placeholder="e.g. Customer increased order volume; updated quantity and ETD."
          maxLength={500}
          data-testid="input-amendment-reason"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Internal-only. Recipients receive a generic “RFQ details revised” notice; this reason
          appears only in the amendment history visible to senior management and commercial
          roles. If left blank, the server uses an automatic summary.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} data-testid="button-edit-cancel">Cancel</Button>
        <Button type="button" disabled={isPending} onClick={submit} data-testid="button-edit-save">
          Save changes
        </Button>
      </div>
    </div>
  );
}

export default function Home() {
  const { role, commercialGrant } = useRole();
  const canCreateRfq = RolePerms.canCreateRfq(role, commercialGrant);
  const canManageSubs = RolePerms.canManageSubcontractors(role);
  const canSendInvite = RolePerms.canSendInvite(role, commercialGrant);
  const canEscalate = RolePerms.canEscalate(role, commercialGrant);
  const canBuyerNegotiate = RolePerms.canBuyerNegotiate(role, commercialGrant);
  const canAcceptOrAward = RolePerms.canAcceptOrAward(role);
  const isFactory = role === "factory_user";
  // "isAdmin" historically gated the senior-management UI surfaces (recommendation review,
  // reference docs, audit trail). Senior Management replaces TEG Admin; group_admin stays
  // accepted as a legacy alias.
  const isAdmin = role === "senior_management" || role === "group_admin";
  const isPlatformAdmin = role === "platform_admin";
  const isCommercial = role === "commercial_staff";
  const isCommercialManager = role === "commercial_manager";

  const [selectedRfqId, setSelectedRfqId] = useState<number | null>(null);
  const [internalFactory, setInternalFactory] = useState("");
  const [escalationSubcontractor, setEscalationSubcontractor] = useState("");
  const [escalationReason, setEscalationReason] = useState("");
  const [routingError, setRoutingError] = useState<string | null>(null);
  // Bulk send state — country filter + multi-select set of subcontractor ids.
  const [bulkCountry, setBulkCountry] = useState<"all" | "Sri Lanka" | "India" | "Indonesia">("all");
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());
  const [bulkResult, setBulkResult] = useState<{ successes: number; failures: { id: number; message: string }[] } | null>(null);
  // Edit RFQ dialog state.
  const [editOpen, setEditOpen] = useState(false);
  // RFQ section filter — 'all' means show every section, otherwise only RFQs whose
  // category matches. Section tabs sit above the RFQ register.
  const [sectionFilter, setSectionFilter] = useState<RfqCategory | "all">("all");
  // Pre-RFQ document uploads. Captured client-side before /api/rfqs returns; once the
  // RFQ is created we attempt to attach them as confidential reference documents.
  // Both files are visible only to Senior Management after attach (see server route).
  const [pricingQuoteFile, setPricingQuoteFile] = useState<File | null>(null);
  const [poFile, setPoFile] = useState<File | null>(null);
  // Status of the post-create attachment attempt. Surfaced to the user as a small
  // banner near the form so a created RFQ is never lost just because attach failed.
  type PreRfqAttachmentStatus = {
    rfqId: number;
    rfqReference: string;
    pricingQuotation: "none" | "ok" | "failed";
    purchaseOrder: "none" | "ok" | "failed";
    pricingQuotationError?: string;
    purchaseOrderError?: string;
  };
  const [attachmentStatus, setAttachmentStatus] = useState<PreRfqAttachmentStatus | null>(null);
  const { toast } = useToast();

  const overview = useQuery<Overview>({ queryKey: ["/api/overview"] });
  const rfqs = useQuery<Rfq[]>({ queryKey: ["/api/rfqs"] });
  const companies = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const factories = useQuery<FactoryLocation[]>({ queryKey: ["/api/factories"] });
  const subcontractors = useQuery<Subcontractor[]>({ queryKey: ["/api/subcontractors"] });
  // Partner / Client master data — filtered by the selected requesting company's cluster
  // so users only see partners that do business with that side of the group. The query
  // is enabled once a requesting company is selected; otherwise we fetch the full list.
  const partnerClientsAll = useQuery<PartnerClient[]>({ queryKey: ["/api/partner-clients"] });
  // System settings drive the configurable response window. Senior Mgmt / Platform Admin can edit;
  // for other roles the GET still succeeds and we just read the displayed default.
  const settings = useQuery<SystemSettings>({ queryKey: ["/api/settings"] });
  const detail = useQuery<RfqDetail>({
    queryKey: ["/api/rfqs", selectedRfqId],
    enabled: Boolean(selectedRfqId),
  });

  const recommendations = useQuery<Recommendation[]>({
    queryKey: ["/api/rfqs", selectedRfqId, "recommendations"],
    enabled:
      Boolean(selectedRfqId) &&
      (isAdmin || isCommercial || isCommercialManager),
  });

  useEffect(() => {
    if (!selectedRfqId && rfqs.data?.length) setSelectedRfqId(rfqs.data[0].id);
  }, [rfqs.data, selectedRfqId]);

  const rfqForm = useForm<z.infer<typeof rfqFormSchema>>({
    resolver: zodResolver(rfqFormSchema),
    defaultValues: {
      requestType: "external_rfq",
      category: "manufacturing_subcontractor",
      requestingCompanyId: "1",
      producingCompanyId: "none",
      producingFactoryId: "none",
      projectName: "",
      packageName: "",
      description: "",
      partnerClient: "",
      poCountry: "",
      poCustomerName: "",
      quantity: "",
      unit: "Containers",
      targetEtd: "",
      responseDue: "",
      marketedLength: "",
      marketedWidth: "",
      marketedHeight: "",
      actualLength: "",
      actualWidth: "",
      actualHeight: "",
      gauge: "",
      etdRequired: "",
      materialSpecification: "",
      productSize: "",
      ecLevel: "",
      manufacturingProductType: "",
      productLines: [
        {
          productType: "",
          materialSpecification: "",
          productSize: "",
          ecLevel: "",
          quantity: "",
          loadabilityPerContainer: "",
          notes: "",
        },
      ],
      priceValidityMonths: "",
    },
  });

  const subcontractorForm = useForm<z.infer<typeof subcontractorSchema>>({
    resolver: zodResolver(subcontractorSchema),
    defaultValues: {
      name: "",
      contactName: "",
      email: "",
      specialty: "",
      country: "Sri Lanka",
      rating: "Approved",
      vendorType: "manufacturing_subcontractor",
      supportedCategories: [],
      materialsSupplied: "",
    },
  });

  useEffect(() => {
    if (companies.data?.[0] && rfqForm.getValues("requestingCompanyId") === "1") {
      rfqForm.setValue("requestingCompanyId", String(companies.data[0].id));
    }
  }, [companies.data, rfqForm]);

  const requestType = rfqForm.watch("requestType");
  const categoryWatch = rfqForm.watch("category");
  // Wooden pallets are factory-managed. Hide them from the create-RFQ category dropdown for
  // commercial users (commercial_staff and commercial_manager). Senior management, platform
  // admin, and factory users can still see / select pallets where appropriate.
  const canSeePalletCategory =
    isAdmin || isPlatformAdmin || isFactory;
  const visibleCategoriesForCreate: RfqCategory[] = useMemo(() => {
    return RFQ_CATEGORIES.filter((cat) => {
      if (cat === "wooden_pallets" && !canSeePalletCategory) return false;
      return true;
    });
  }, [canSeePalletCategory]);
  // Section tab visibility — same rule. Pallet rows still exist for senior mgmt / platform / factory,
  // but commercial dashboards never show the pallet tab so it doesn't suggest commercial ownership.
  const visibleCategoriesForTabs: RfqCategory[] = useMemo(() => {
    return RFQ_CATEGORIES.filter((cat) => {
      if (cat === "wooden_pallets" && !canSeePalletCategory) return false;
      return true;
    });
  }, [canSeePalletCategory]);
  // If a commercial user somehow had wooden_pallets selected (shouldn't happen, but guard
  // against legacy state), snap back to manufacturing_subcontractor.
  useEffect(() => {
    if (!canSeePalletCategory && categoryWatch === "wooden_pallets") {
      rfqForm.setValue("category", "manufacturing_subcontractor");
    }
  }, [canSeePalletCategory, categoryWatch, rfqForm]);
  // Same guard for the section-tab filter — if a commercial user lands on the pallet tab
  // (e.g. via deep link), bounce them back to "all" so the dashboard stays consistent.
  useEffect(() => {
    if (!canSeePalletCategory && sectionFilter === "wooden_pallets") {
      setSectionFilter("all");
    }
  }, [canSeePalletCategory, sectionFilter]);
  // When the request type is internal ETD or intercompany the category is fixed to
  // manufacturing_subcontractor (factory production work). Sync the field automatically
  // so commercial users don't have to remember the rule.
  useEffect(() => {
    if (
      (requestType === "internal_etd" || requestType === "intercompany") &&
      categoryWatch !== "manufacturing_subcontractor"
    ) {
      rfqForm.setValue("category", "manufacturing_subcontractor");
    }
  }, [requestType, categoryWatch, rfqForm]);
  // Inverse rule: if the user picks a non-manufacturing supplier category, force the
  // request type to external_rfq. Only manufacturing supports internal/intercompany.
  useEffect(() => {
    if (
      categoryWatch !== "manufacturing_subcontractor" &&
      requestType !== "external_rfq"
    ) {
      rfqForm.setValue("requestType", "external_rfq");
    }
  }, [categoryWatch, requestType, rfqForm]);
  // Splits only make sense for manufacturing — reset the toggle if the user moves away.
  // (Splits removed from create form — only present in Edit RFQ panel per-product-line.)
  const selectedDetail = detail.data;
  const hasInternalInvite = Boolean(selectedDetail?.invites.some((invite) => invite.negotiationScope === "etd_only"));
  const recommendationsList = recommendations.data ?? [];
  const pendingRecommendation = recommendationsList.find((rec) => rec.status === "pending") ?? null;
  const hasOpenRecommendation = Boolean(pendingRecommendation);

  // India routing client check: GRT cannot send to Indian subcontractors.
  const requestingCompanyForSelected = selectedDetail?.rfq.requestingCompanyId
    ? companies.data?.find((c) => c.id === selectedDetail.rfq.requestingCompanyId) ?? null
    : null;
  const requestingCode = requestingCompanyForSelected?.code ?? "";
  const isIndiaRoutingBlocked = (subcontractorId: string) => {
    if (!subcontractorId) return false;
    const sub = subcontractors.data?.find((s) => s.id === Number(subcontractorId));
    if (!sub || sub.country !== "India") return false;
    return (INDIA_BLOCKED_REQUESTING_COMPANY_CODES as readonly string[]).includes(requestingCode);
  };
  const escalationIndiaBlocked = isIndiaRoutingBlocked(escalationSubcontractor);

  // Attach the pre-create Pricing Quotation and Purchase Order to a freshly
  // created RFQ. Best-effort: each upload runs independently and a failure on
  // one does not block the other or the RFQ itself. Status is surfaced via
  // attachmentStatus + a toast warning when something fails.
  async function attachPreRfqDocuments(
    created: Rfq,
    pq: File | null,
    po: File | null,
  ): Promise<void> {
    if (!pq && !po) {
      setAttachmentStatus(null);
      return;
    }
    const next: PreRfqAttachmentStatus = {
      rfqId: created.id,
      rfqReference: created.reference,
      pricingQuotation: pq ? "failed" : "none",
      purchaseOrder: po ? "failed" : "none",
    };
    async function uploadOne(file: File, type: "purchase_order" | "pricing_quotation") {
      const contentBase64 = await readFileBase64Stripped(file);
      const response = await apiRequest("POST", `/api/rfqs/${created.id}/documents`, {
        documentType: type,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        contentBase64,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text || `Upload failed (${response.status})`);
      }
    }
    const tasks: Promise<void>[] = [];
    if (pq) {
      tasks.push(
        uploadOne(pq, "pricing_quotation")
          .then(() => {
            next.pricingQuotation = "ok";
          })
          .catch((err: unknown) => {
            next.pricingQuotation = "failed";
            next.pricingQuotationError = err instanceof Error ? err.message : String(err);
          }),
      );
    }
    if (po) {
      tasks.push(
        uploadOne(po, "purchase_order")
          .then(() => {
            next.purchaseOrder = "ok";
          })
          .catch((err: unknown) => {
            next.purchaseOrder = "failed";
            next.purchaseOrderError = err instanceof Error ? err.message : String(err);
          }),
      );
    }
    await Promise.all(tasks);
    setAttachmentStatus(next);
    queryClient.invalidateQueries({ queryKey: ["/api/rfqs", created.id, "documents"] });
    const failures: string[] = [];
    if (next.pricingQuotation === "failed") {
      failures.push(`Pricing Quotation: ${next.pricingQuotationError ?? "upload failed"}`);
    }
    if (next.purchaseOrder === "failed") {
      failures.push(`Purchase Order: ${next.purchaseOrderError ?? "upload failed"}`);
    }
    if (failures.length > 0) {
      toast({
        title: `RFQ ${created.reference} created, but document attach failed`,
        description: failures.join(" \u2014 "),
        variant: "destructive",
      });
    } else if (tasks.length > 0) {
      const labels: string[] = [];
      if (next.pricingQuotation === "ok") labels.push("Pricing Quotation");
      if (next.purchaseOrder === "ok") labels.push("Purchase Order");
      toast({
        title: `RFQ ${created.reference} created`,
        description: `Attached ${labels.join(" + ")} as confidential reference document${labels.length > 1 ? "s" : ""}.`,
      });
    }
  }

  const createRfq = useMutation({
    mutationFn: async (values: z.infer<typeof rfqFormSchema>) => {
      const isPolybag = values.category === "polythene_bags";
      const isPriceValidity = values.category === "wooden_pallets" || values.category === "cardboard";
      const isManufacturingCategoryEarly = values.category === "manufacturing_subcontractor";
      const polybagSpecs = isPolybag
        ? {
            marketedSize: {
              length: values.marketedLength?.trim() ?? "",
              width: values.marketedWidth?.trim() ?? "",
              height: values.marketedHeight?.trim() ?? "",
            },
            actualSize: {
              length: values.actualLength?.trim() ?? "",
              width: values.actualWidth?.trim() ?? "",
              height: values.actualHeight?.trim() ?? "",
            },
            gauge: values.gauge?.trim() ?? "",
            etdRequired: values.etdRequired?.trim() ?? "",
          }
        : undefined;
      const isManufacturingCategory = isManufacturingCategoryEarly;
      // Multi-product manufacturing: send productLines for any manufacturing RFQ.
      const productLines: ProductLine[] | undefined = isManufacturingCategory
        ? (values.productLines ?? [])
            .filter(
              (l) =>
                l.productType &&
                l.materialSpecification?.trim() &&
                l.productSize?.trim() &&
                l.ecLevel?.trim() &&
                l.quantity?.trim() &&
                l.loadabilityPerContainer?.trim(),
            )
            .map((l) => ({
              productType: l.productType as ManufacturingProductType,
              materialSpecification: l.materialSpecification!.trim(),
              productSize: l.productSize!.trim(),
              ecLevel: l.ecLevel!.trim(),
              quantity: l.quantity!.trim(),
              loadabilityPerContainer: l.loadabilityPerContainer!.trim(),
              notes: l.notes?.trim() ? l.notes.trim() : null,
            }))
        : undefined;
      // Splits removed from create flow — added per-product-line via Edit RFQ.
      const priceValidityMonths =
        isPriceValidity && values.priceValidityMonths && values.priceValidityMonths.trim()
          ? Number(values.priceValidityMonths)
          : undefined;
      // For manufacturing RFQs, derive top-level quantity/unit from the first product
      // line so the rfqs row keeps useful summary values (the columns are still required
      // server-side). Multi-product RFQs show "Multiple products" as the row-level summary.
      const aggregateQuantity = isManufacturingCategory && productLines && productLines.length > 0
        ? productLines.length > 1
          ? "Multiple products"
          : productLines[0].quantity
        : values.quantity;
      const aggregateUnit = isManufacturingCategory && productLines && productLines.length > 0
        ? productLines.length > 1
          ? "see product lines"
          : productLines[0].loadabilityPerContainer
        : values.unit;
      const payload: Record<string, unknown> = {
        requestType: values.requestType,
        category: values.category,
        targetEtd: values.targetEtd,
        responseDue: values.responseDue,
        requestingCompanyId: Number(values.requestingCompanyId),
        producingCompanyId: values.producingCompanyId && values.producingCompanyId !== "none" ? Number(values.producingCompanyId) : null,
        producingFactoryId: values.producingFactoryId && values.producingFactoryId !== "none" ? Number(values.producingFactoryId) : null,
      };
      if (isManufacturingCategory) {
        // Product Manufacturing only sends Partner / Country / PO Customer. Project /
        // Order / Scope are derived server-side from those values + the product list.
        payload.partnerClient = values.partnerClient?.trim();
        payload.poCountry = values.poCountry?.trim();
        payload.poCustomerName = values.poCustomerName?.trim();
        if (aggregateQuantity) payload.quantity = aggregateQuantity;
        if (aggregateUnit) payload.unit = aggregateUnit;
      } else {
        payload.projectName = values.projectName;
        payload.packageName = values.packageName;
        payload.description = values.description;
        payload.quantity = aggregateQuantity;
        payload.unit = aggregateUnit;
      }
      if (polybagSpecs) payload.polybagSpecs = polybagSpecs;
      if (productLines && productLines.length > 0) payload.productLines = productLines;
      if (priceValidityMonths) payload.priceValidityMonths = priceValidityMonths;
      const response = await apiRequest("POST", "/api/rfqs", payload);
      return response.json() as Promise<Rfq>;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfqs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
      setSelectedRfqId(created.id);
      // Snapshot the captured pre-create files so the async attach below uses
      // the values from the moment the user submitted, even if they pick new
      // files immediately after.
      const pq = pricingQuoteFile;
      const po = poFile;
      void attachPreRfqDocuments(created, pq, po);
      setPricingQuoteFile(null);
      setPoFile(null);
      rfqForm.reset({
        requestType: "external_rfq",
        category: "manufacturing_subcontractor",
        requestingCompanyId: companies.data?.[0] ? String(companies.data[0].id) : "1",
        producingCompanyId: "none",
        producingFactoryId: "none",
        projectName: "",
        packageName: "",
        description: "",
        partnerClient: "",
        poCountry: "",
        poCustomerName: "",
        quantity: "",
        unit: "Containers",
        targetEtd: "",
        responseDue: "",
        marketedLength: "",
        marketedWidth: "",
        marketedHeight: "",
        actualLength: "",
        actualWidth: "",
        actualHeight: "",
        gauge: "",
        etdRequired: "",
        materialSpecification: "",
        productSize: "",
        ecLevel: "",
        manufacturingProductType: "",
        productLines: [
          {
            productType: "",
            materialSpecification: "",
            productSize: "",
            ecLevel: "",
            quantity: "",
            loadabilityPerContainer: "",
            notes: "",
          },
        ],
        priceValidityMonths: "",
      });
    },
  });

  const createSubcontractor = useMutation({
    mutationFn: async (values: z.infer<typeof subcontractorSchema>) => {
      const response = await apiRequest("POST", "/api/subcontractors", values);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractors"] });
      subcontractorForm.reset({
        name: "",
        contactName: "",
        email: "",
        specialty: "",
        country: "Sri Lanka",
        rating: "Approved",
        vendorType: "manufacturing_subcontractor",
        supportedCategories: [],
        materialsSupplied: "",
      });
    },
  });

  const sendInvite = useMutation({
    mutationFn: async (payload: { recipientType: "external_subcontractor" | "internal_factory"; subcontractorId?: number; factoryId?: number }) => {
      if (!selectedRfqId) return undefined;
      const response = await apiRequest("POST", `/api/rfqs/${selectedRfqId}/invites`, payload);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfqs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfqs", selectedRfqId] });
      queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
      setInternalFactory("");
      setRoutingError(null);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Could not send invite";
      setRoutingError(msg);
    },
  });

  const bulkSend = useMutation({
    mutationFn: async (payload: { country: string | null; subcontractorIds: number[] }) => {
      if (!selectedRfqId) return undefined;
      const response = await apiRequest("POST", `/api/rfqs/${selectedRfqId}/invites/bulk`, {
        recipientType: "external_subcontractor",
        country: payload.country,
        subcontractorIds: payload.subcontractorIds,
      });
      return response.json() as Promise<{ successes: any[]; failures: { id: number; message: string }[] }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfqs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfqs", selectedRfqId] });
      queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      if (data) {
        setBulkResult({ successes: data.successes.length, failures: data.failures });
        if (data.failures.length === 0) {
          setBulkSelected(new Set());
        }
      }
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Could not send bulk invites";
      setRoutingError(msg);
    },
  });

  const editRfq = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      if (!selectedRfqId) return undefined;
      const response = await apiRequest("PATCH", `/api/rfqs/${selectedRfqId}`, patch);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfqs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfqs", selectedRfqId] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      setEditOpen(false);
    },
  });

  const escalate = useMutation({
    mutationFn: async () => {
      if (!selectedRfqId) return undefined;
      const response = await apiRequest("POST", `/api/rfqs/${selectedRfqId}/escalate`, {
        subcontractorId: Number(escalationSubcontractor),
        reason: escalationReason,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfqs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfqs", selectedRfqId] });
      queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
      setEscalationReason("");
      setEscalationSubcontractor("");
      setRoutingError(null);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Could not escalate";
      setRoutingError(msg);
    },
  });

  // Section counts — driven from the (already-scoped) RFQ list. Used by the section tabs
  // below the create-RFQ form so users can hop between Manufacturing and Supplier sections.
  // For commercial users, pallets are excluded from the totals (they don't see them anywhere).
  const sectionCounts = useMemo(() => {
    const counts: Record<RfqCategory | "all", number> = {
      all: 0,
      manufacturing_subcontractor: 0,
      wooden_pallets: 0,
      polythene_bags: 0,
      cardboard: 0,
      packaging_materials: 0,
      logistics_shipping: 0,
      other_supplies: 0,
    };
    for (const r of rfqs.data ?? []) {
      const cat = (r.category ?? "manufacturing_subcontractor") as RfqCategory;
      if (!canSeePalletCategory && cat === "wooden_pallets") continue;
      counts.all += 1;
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
    return counts;
  }, [rfqs.data, canSeePalletCategory]);

  const filteredRfqs = useMemo(() => {
    const list = rfqs.data ?? [];
    // Commercial users should never see pallet RFQs in their register — those are
    // factory-managed and live on the factory / senior-management side.
    const visible = canSeePalletCategory
      ? list
      : list.filter((r) => (r.category ?? "manufacturing_subcontractor") !== "wooden_pallets");
    if (sectionFilter === "all") return visible;
    return visible.filter((r) => (r.category ?? "manufacturing_subcontractor") === sectionFilter);
  }, [rfqs.data, sectionFilter, canSeePalletCategory]);

  // Vendor picker filter — narrow the list down to those vendors whose supportedCategories
  // / vendorType match the selected RFQ's category. Cluster + India routing rules are layered
  // on top via existing helpers.
  const selectedRfqCategory: RfqCategory =
    (selectedDetail?.rfq.category as RfqCategory) ?? "manufacturing_subcontractor";
  const vendorsForSelectedRfq = useMemo(() => {
    const all = subcontractors.data ?? [];
    return all.filter((sub) =>
      isVendorAllowedForCategory(sub.vendorType, sub.supportedCategories, selectedRfqCategory),
    );
  }, [subcontractors.data, selectedRfqCategory]);

  const vendorsForBulkPicker = useMemo(() => {
    if (bulkCountry === "all") return vendorsForSelectedRfq;
    return vendorsForSelectedRfq.filter((sub) => sub.country === bulkCountry);
  }, [vendorsForSelectedRfq, bulkCountry]);

  // Reset bulk state when the selected RFQ changes — a fresh selection per RFQ.
  useEffect(() => {
    setBulkSelected(new Set());
    setBulkResult(null);
    setBulkCountry("all");
  }, [selectedRfqId]);

  const metrics = useMemo(
    () => [
      { label: "Total requests", value: overview.data?.totalRfqs ?? 0, icon: Send },
      { label: "ETD-only", value: overview.data?.etdOnlyRequests ?? 0, icon: ShieldOff },
      { label: "Escalated outside", value: overview.data?.externalEscalations ?? 0, icon: Globe2 },
      { label: "Accepted", value: overview.data?.acceptedOrders ?? 0, icon: CheckCircle2 },
      { label: "Awaiting replies", value: overview.data?.pendingResponses ?? 0, icon: Clock3 },
    ],
    [overview.data],
  );

  return (
    <main
      className="flex-1 overflow-auto p-4 md:p-6"
      data-testid={isFactory ? "page-factory-dashboard" : "page-internal-dashboard"}
    >
      <div className="mx-auto grid w-full min-w-0 max-w-7xl gap-6 [&>*]:min-w-0">
        <YourAccessCard />
        <UserDirectory />
        <SystemSettingsPanel />
        <SubcontractorClusterAccessPanel />
        <AuthSetupNote />

        {isFactory && (
          <section
            className="rounded-2xl border border-amber-200 bg-amber-50/50 p-5 dark:border-amber-900 dark:bg-amber-950/20"
            data-testid="banner-factory-scope"
          >
            <div className="flex items-start gap-3">
              <Factory className="mt-0.5 h-5 w-5 text-amber-700 dark:text-amber-300" />
              <div>
                <p className="font-semibold text-amber-900 dark:text-amber-200">Internal ETD work queue</p>
                <p className="text-sm text-amber-900/80 dark:text-amber-200/80">
                  You only see RFQs assigned to your factory as ETD-only requests. Pricing is intentionally hidden — confirm or revise dispatch dates only.
                </p>
              </div>
            </div>
          </section>
        )}

        {isCommercial && (
          <section
            className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-5 dark:border-indigo-900 dark:bg-indigo-950/20"
            data-testid="banner-commercial-scope"
          >
            <div className="flex items-start gap-3">
              <Send className="mt-0.5 h-5 w-5 text-indigo-700 dark:text-indigo-300" />
              <div>
                <p
                  className="font-semibold text-indigo-900 dark:text-indigo-200"
                  data-testid="text-commercial-banner-title"
                >
                  Commercial staff (cluster-scoped)
                </p>
                <p
                  className="text-sm text-indigo-900/80 dark:text-indigo-200/80"
                  data-testid="text-commercial-banner-body"
                >
                  Commercial staff can create RFQs. Senior Management allowance required to send, negotiate, or recommend award.
                  {" "}
                  {commercialGrant
                    ? "Allowance is GRANTED — you can send invites, escalate, counter, and submit award recommendations. You still cannot accept, decline, or award."
                    : "Allowance is NOT GRANTED — you can open / create RFQs and browse, but cannot yet send invites, escalate, counter, or recommend an award."}
                </p>
              </div>
            </div>
          </section>
        )}

        <section className="grid gap-4 md:grid-cols-5">
          {metrics.map((metric) => (
            <Card key={metric.label}>
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <p className="text-sm text-muted-foreground">{metric.label}</p>
                  <p className="text-xl font-semibold tabular-nums" data-testid={`metric-${metric.label.toLowerCase().replaceAll(" ", "-")}`}>
                    {metric.value}
                  </p>
                </div>
                <metric.icon className="h-5 w-5 text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
        </section>

        <NotificationCenter />

        {isAdmin && <AuditTrailPanel variant="card" limit={20} />}

        <section className={`grid gap-6 ${(canCreateRfq || canManageSubs) ? "xl:grid-cols-[430px_1fr]" : ""}`}>
          {(canCreateRfq || canManageSubs) && (
          <div className="grid min-w-0 gap-6" data-testid="region-buyer-controls">
            {canCreateRfq && (
            <Card data-testid="card-create-rfq">
              <CardHeader>
                <CardTitle>Create request</CardTitle>
                <CardDescription>Choose commercial RFQ, internal ETD-only, or intercompany production.</CardDescription>
                {isCommercial && !commercialGrant && (
                  <p
                    className="mt-2 rounded-md border border-indigo-200 bg-indigo-50/60 p-2 text-xs text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200"
                    data-testid="text-create-rfq-commercial-notice"
                  >
                    Commercial staff can create RFQs. Senior Management allowance required to send, negotiate, or recommend
                    award.
                  </p>
                )}
              </CardHeader>
              <CardContent>
                {attachmentStatus && (
                  <div
                    className={`mb-3 rounded-md border p-2 text-[12px] ${
                      attachmentStatus.pricingQuotation === "failed" || attachmentStatus.purchaseOrder === "failed"
                        ? "border-amber-300 bg-amber-50/80 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                        : "border-emerald-300 bg-emerald-50/80 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                    }`}
                    data-testid="panel-pre-rfq-attach-status"
                    role="status"
                  >
                    <p className="font-semibold">
                      RFQ {attachmentStatus.rfqReference} created.
                    </p>
                    <ul className="mt-1 list-disc pl-4">
                      {attachmentStatus.pricingQuotation !== "none" && (
                        <li data-testid="text-attach-pricing-quotation">
                          Pricing Quotation:{" "}
                          {attachmentStatus.pricingQuotation === "ok"
                            ? "attached"
                            : `not attached \u2014 ${attachmentStatus.pricingQuotationError ?? "upload failed"}`}
                        </li>
                      )}
                      {attachmentStatus.purchaseOrder !== "none" && (
                        <li data-testid="text-attach-purchase-order">
                          Purchase Order:{" "}
                          {attachmentStatus.purchaseOrder === "ok"
                            ? "attached"
                            : `not attached \u2014 ${attachmentStatus.purchaseOrderError ?? "upload failed"}`}
                        </li>
                      )}
                    </ul>
                    <button
                      type="button"
                      onClick={() => setAttachmentStatus(null)}
                      className="mt-1 text-[11px] underline"
                      data-testid="button-attach-status-dismiss"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
                <Form {...rfqForm}>
                  <form className="grid gap-4" onSubmit={rfqForm.handleSubmit((values) => createRfq.mutate(values))}>
                    <div
                      className="rounded-xl border bg-muted/30 p-3"
                      data-testid="panel-request-type"
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Step 1 — Request type
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Pick how this inquiry should be routed. This drives category, price visibility, and recipient options.
                      </p>
                      <FormField
                        control={rfqForm.control}
                        name="requestType"
                        render={({ field }) => (
                          <FormItem className="mt-3">
                            <div className="grid gap-2 md:grid-cols-3">
                              {REQUEST_TYPE_OPTIONS.map((opt) => {
                                const selected = field.value === opt.value;
                                // Internal ETD / Intercompany are reserved for Product Manufacturing.
                                // Disable them when the active category is anything else, and surface
                                // a tooltip-friendly notice. The category effect above also auto-snaps
                                // requestType back to external_rfq if needed.
                                const restrictedToMfg =
                                  opt.value !== "external_rfq" &&
                                  categoryWatch !== "manufacturing_subcontractor";
                                return (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    disabled={restrictedToMfg}
                                    onClick={() => !restrictedToMfg && field.onChange(opt.value)}
                                    title={restrictedToMfg ? "Available only for Product Manufacturing" : undefined}
                                    aria-disabled={restrictedToMfg}
                                    className={`rounded-lg border p-3 text-left transition hover:border-primary/60 ${
                                      selected
                                        ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                                        : restrictedToMfg
                                          ? "cursor-not-allowed border-dashed bg-muted/30 opacity-60"
                                          : "bg-card"
                                    }`}
                                    data-testid={`radio-request-type-${opt.value}`}
                                  >
                                    <p className="text-sm font-semibold">{opt.title}</p>
                                    <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                                      {opt.description}
                                    </p>
                                    {restrictedToMfg && (
                                      <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
                                        Manufacturing only
                                      </p>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                            {categoryWatch !== "manufacturing_subcontractor" && (
                              <p
                                className="mt-2 rounded-md border border-amber-200 bg-amber-50/60 p-2 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
                                data-testid="text-supplier-external-only"
                              >
                                Supplier / material categories are external vendor RFQs only — Internal Factory ETD and Intercompany Production are reserved for Product Manufacturing.
                              </p>
                            )}
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={rfqForm.control}
                      name="category"
                      render={({ field }) => {
                        const lockedToManufacturing =
                          requestType === "internal_etd" || requestType === "intercompany";
                        return (
                          <FormItem>
                            <FormLabel>RFQ section</FormLabel>
                            <Select
                              value={field.value ?? "manufacturing_subcontractor"}
                              onValueChange={field.onChange}
                              disabled={lockedToManufacturing}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-rfq-category">
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {visibleCategoriesForCreate.map((cat) => (
                                  <SelectItem key={cat} value={cat}>
                                    {RFQ_CATEGORY_META[cat].label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p
                              className="text-xs text-muted-foreground"
                              data-testid="text-rfq-category-help"
                            >
                              {lockedToManufacturing
                                ? "Internal ETD-only and intercompany requests sit in the Manufacturing Subcontractor section."
                                : RFQ_CATEGORY_META[(field.value ?? "manufacturing_subcontractor") as RfqCategory].description}
                            </p>
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />

                    <FormField
                      control={rfqForm.control}
                      name="requestingCompanyId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Requesting company</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger data-testid="select-requesting-company">
                                <SelectValue placeholder="Select company" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {companies.data?.map((company) => (
                                <SelectItem key={company.id} value={String(company.id)}>
                                  {company.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {requestType !== "external_rfq" && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <FormField
                          control={rfqForm.control}
                          name="producingCompanyId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Producing company</FormLabel>
                              <Select value={field.value} onValueChange={field.onChange}>
                                <FormControl>
                                  <SelectTrigger data-testid="select-producing-company">
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="none">Not assigned</SelectItem>
                                  {companies.data?.map((company) => (
                                    <SelectItem key={company.id} value={String(company.id)}>
                                      {company.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={rfqForm.control}
                          name="producingFactoryId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Target factory</FormLabel>
                              <Select value={field.value} onValueChange={field.onChange}>
                                <FormControl>
                                  <SelectTrigger data-testid="select-producing-factory">
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="none">Not assigned</SelectItem>
                                  {factories.data?.map((factory) => (
                                    <SelectItem key={factory.id} value={String(factory.id)}>
                                      {factory.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    )}

                    {categoryWatch === "manufacturing_subcontractor" ? (
                      <ProductManufacturingPoFields
                        form={rfqForm}
                        partnerClients={partnerClientsAll.data ?? []}
                        companies={companies.data ?? []}
                        pricingQuoteFile={pricingQuoteFile}
                        setPricingQuoteFile={setPricingQuoteFile}
                        poFile={poFile}
                        setPoFile={setPoFile}
                      />
                    ) : (
                      <>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <FormField
                            control={rfqForm.control}
                            name="projectName"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Project</FormLabel>
                                <FormControl>
                                  <Input data-testid="input-rfq-project" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={rfqForm.control}
                            name="packageName"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Order / product</FormLabel>
                                <FormControl>
                                  <Input data-testid="input-rfq-package" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <FormField
                          control={rfqForm.control}
                          name="description"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Scope description</FormLabel>
                              <FormControl>
                                <Textarea data-testid="textarea-rfq-description" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </>
                    )}

                    {(categoryWatch === "wooden_pallets" || categoryWatch === "cardboard") && (
                      <div
                        className="grid gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/30"
                        data-testid="panel-price-validity-inquiry"
                      >
                        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                          {DEFAULT_PRICE_VALIDITY_MONTHS}-month price-validity inquiry — not a single-order RFQ.
                        </p>
                        <p className="text-amber-900/80 dark:text-amber-200/80">
                          {categoryWatch === "wooden_pallets"
                            ? "Wooden pallets are factory-managed. The supplier submits a unit price valid for a fixed window (default 6 months); a purchase order is issued later when the factory needs stock."
                            : "Cardboard / carton suppliers submit a unit price valid for a fixed window (default 6 months); TEG issues purchase orders later as quantities are required."}
                        </p>
                        <FormField
                          control={rfqForm.control}
                          name="priceValidityMonths"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Price validity (months)</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  min="1"
                                  max="60"
                                  placeholder={String(DEFAULT_PRICE_VALIDITY_MONTHS)}
                                  data-testid="input-price-validity-months"
                                  {...field}
                                />
                              </FormControl>
                              <p className="text-xs text-muted-foreground">
                                Leave blank to default to {DEFAULT_PRICE_VALIDITY_MONTHS} months.
                              </p>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    )}

                    {categoryWatch === "polythene_bags" && (
                      <div
                        className="grid gap-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 text-xs dark:border-indigo-900 dark:bg-indigo-950/30"
                        data-testid="panel-polybag-specs"
                      >
                        <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
                          Polythene bag inquiry specs (required)
                        </p>
                        <p className="text-indigo-900/80 dark:text-indigo-200/80">
                          The supplier needs both the marketed (market) size and the actual bag size, plus gauge, quantity, and ETD required. Suppliers respond with price (USD) + delivery date; TEG selects the lowest and renegotiates as usual.
                        </p>
                        <div className="grid gap-2 rounded-lg border border-indigo-200 bg-white/40 p-2 dark:border-indigo-800 dark:bg-indigo-950/40">
                          <p className="text-xs font-semibold text-indigo-900 dark:text-indigo-200">Marketed size (L × W × H)</p>
                          <div className="grid gap-2 sm:grid-cols-3">
                            <FormField control={rfqForm.control} name="marketedLength" render={({ field }) => (
                              <FormItem>
                                <FormLabel>Length</FormLabel>
                                <FormControl><Input placeholder="e.g. 40 cm" data-testid="input-polybag-marketed-length" {...field} /></FormControl>
                                <FormMessage />
                              </FormItem>
                            )} />
                            <FormField control={rfqForm.control} name="marketedWidth" render={({ field }) => (
                              <FormItem>
                                <FormLabel>Width</FormLabel>
                                <FormControl><Input placeholder="e.g. 60 cm" data-testid="input-polybag-marketed-width" {...field} /></FormControl>
                                <FormMessage />
                              </FormItem>
                            )} />
                            <FormField control={rfqForm.control} name="marketedHeight" render={({ field }) => (
                              <FormItem>
                                <FormLabel>Height</FormLabel>
                                <FormControl><Input placeholder="e.g. 5 cm" data-testid="input-polybag-marketed-height" {...field} /></FormControl>
                                <FormMessage />
                              </FormItem>
                            )} />
                          </div>
                        </div>
                        <div className="grid gap-2 rounded-lg border border-indigo-200 bg-white/40 p-2 dark:border-indigo-800 dark:bg-indigo-950/40">
                          <p className="text-xs font-semibold text-indigo-900 dark:text-indigo-200">Actual bag size (L × W × H)</p>
                          <div className="grid gap-2 sm:grid-cols-3">
                            <FormField control={rfqForm.control} name="actualLength" render={({ field }) => (
                              <FormItem>
                                <FormLabel>Length</FormLabel>
                                <FormControl><Input placeholder="e.g. 42 cm" data-testid="input-polybag-actual-length" {...field} /></FormControl>
                                <FormMessage />
                              </FormItem>
                            )} />
                            <FormField control={rfqForm.control} name="actualWidth" render={({ field }) => (
                              <FormItem>
                                <FormLabel>Width</FormLabel>
                                <FormControl><Input placeholder="e.g. 62 cm" data-testid="input-polybag-actual-width" {...field} /></FormControl>
                                <FormMessage />
                              </FormItem>
                            )} />
                            <FormField control={rfqForm.control} name="actualHeight" render={({ field }) => (
                              <FormItem>
                                <FormLabel>Height</FormLabel>
                                <FormControl><Input placeholder="e.g. 6 cm" data-testid="input-polybag-actual-height" {...field} /></FormControl>
                                <FormMessage />
                              </FormItem>
                            )} />
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <FormField
                            control={rfqForm.control}
                            name="gauge"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Gauge</FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder="e.g. 100 micron"
                                    data-testid="input-polybag-gauge"
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={rfqForm.control}
                            name="etdRequired"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>ETD required (delivery date you need)</FormLabel>
                                <FormControl>
                                  <Input
                                    type="date"
                                    data-testid="input-polybag-etd-required"
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          Quantity and unit are taken from the standard quantity / unit fields below.
                        </p>
                      </div>
                    )}

                    {categoryWatch === "manufacturing_subcontractor" && (
                      <ProductLinesField
                        form={rfqForm}
                        isExternal={requestType === "external_rfq"}
                      />
                    )}

                    {categoryWatch !== "manufacturing_subcontractor" && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <FormField
                          control={rfqForm.control}
                          name="quantity"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Quantity</FormLabel>
                              <FormControl>
                                <Input data-testid="input-rfq-quantity" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={rfqForm.control}
                          name="unit"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Unit</FormLabel>
                              <FormControl>
                                <Input data-testid="input-rfq-unit" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <FormField
                        control={rfqForm.control}
                        name="targetEtd"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Target ETD</FormLabel>
                            <FormControl>
                              <Input type="date" data-testid="input-rfq-etd" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={rfqForm.control}
                        name="responseDue"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Response due</FormLabel>
                            <FormControl>
                              <Input
                                type="date"
                                aria-describedby="hint-response-due"
                                data-testid="input-rfq-due"
                                {...field}
                              />
                            </FormControl>
                            <p id="hint-response-due" className="text-xs text-muted-foreground">
                              {(() => {
                                const d = settings.data?.responseDefaultDays ?? DEFAULT_RFQ_RESPONSE_BUSINESS_DAYS;
                                const m = (settings.data?.responseDayMode ?? "calendar") === "calendar"
                                  ? "calendar"
                                  : "business";
                                const label = `${d} ${m} day${d === 1 ? "" : "s"}`;
                                const hint = d === 1 && m === "calendar" ? `${label} (24 hours)` : label;
                                return `Leave blank to default to ${hint} from creation.`;
                              })()}
                            </p>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <Button type="submit" disabled={createRfq.isPending} data-testid="button-create-rfq">
                      <Plus className="mr-2 h-4 w-4" />
                      Create request
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
            )}

            {canManageSubs && (
            <Card data-testid="card-add-subcontractor">
              <CardHeader>
                <CardTitle>Add vendor</CardTitle>
                <CardDescription>
                  Manufacturing subcontractors and material / service suppliers (pallets, polythene bags,
                  cardboard, packaging, logistics, other). Located in Sri Lanka, India, or Indonesia.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...subcontractorForm}>
                  <form className="grid gap-3" onSubmit={subcontractorForm.handleSubmit((values) => createSubcontractor.mutate(values))}>
                    <FormField
                      control={subcontractorForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Company</FormLabel>
                          <FormControl>
                            <Input data-testid="input-subcontractor-name" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <FormField
                        control={subcontractorForm.control}
                        name="contactName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Contact</FormLabel>
                            <FormControl>
                              <Input data-testid="input-subcontractor-contact" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={subcontractorForm.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input type="email" data-testid="input-subcontractor-email" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <FormField
                        control={subcontractorForm.control}
                        name="country"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Country</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl>
                                <SelectTrigger data-testid="select-subcontractor-country">
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="Sri Lanka">Sri Lanka</SelectItem>
                                <SelectItem value="India">India</SelectItem>
                                <SelectItem value="Indonesia">Indonesia</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={subcontractorForm.control}
                        name="rating"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Rating</FormLabel>
                            <FormControl>
                              <Input data-testid="input-subcontractor-rating" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={subcontractorForm.control}
                      name="specialty"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Specialty</FormLabel>
                          <FormControl>
                            <Input data-testid="input-subcontractor-specialty" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={subcontractorForm.control}
                      name="vendorType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Vendor type</FormLabel>
                          <Select
                            value={field.value}
                            onValueChange={(v) => {
                              field.onChange(v);
                              // When switching to manufacturing vendors, clear supplier categories
                              // so the picker doesn't accidentally restrict it. Manufacturing
                              // vendors are always allowed for the manufacturing_subcontractor section.
                              if (v === "manufacturing_subcontractor") {
                                subcontractorForm.setValue("supportedCategories", []);
                              }
                            }}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-vendor-type">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="manufacturing_subcontractor">Manufacturing Subcontractor</SelectItem>
                              <SelectItem value="supplier">Supplier (materials / services)</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {subcontractorForm.watch("vendorType") === "supplier" && (
                      <FormField
                        control={subcontractorForm.control}
                        name="supportedCategories"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Supported categories</FormLabel>
                            <p className="text-xs text-muted-foreground">
                              Pick every RFQ section this supplier can quote for. Leave empty to default to “Other Suppliers.”
                            </p>
                            <div className="grid gap-2 sm:grid-cols-2" data-testid="group-supported-categories">
                              {RFQ_CATEGORIES.filter((c) => c !== "manufacturing_subcontractor").map((cat) => {
                                const checked = (field.value as string[] | undefined)?.includes(cat) ?? false;
                                return (
                                  <label
                                    key={cat}
                                    className="flex items-start gap-2 rounded-md border p-2 text-xs hover:bg-accent"
                                    data-testid={`checkbox-supported-${cat}`}
                                  >
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={(value) => {
                                        const next = new Set<string>(field.value ?? []);
                                        if (value) next.add(cat);
                                        else next.delete(cat);
                                        field.onChange(Array.from(next));
                                      }}
                                    />
                                    <span>
                                      <span className="font-medium">{RFQ_CATEGORY_META[cat].label}</span>
                                      <br />
                                      <span className="text-muted-foreground">{RFQ_CATEGORY_META[cat].description}</span>
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                    <FormField
                      control={subcontractorForm.control}
                      name="materialsSupplied"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Materials / services supplied (optional)</FormLabel>
                          <FormControl>
                            <Input
                              data-testid="input-materials-supplied"
                              placeholder="e.g. ISPM-15 wooden pallets, crates, dunnage"
                              value={field.value ?? ""}
                              onChange={field.onChange}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" variant="outline" disabled={createSubcontractor.isPending} data-testid="button-create-subcontractor">
                      Add vendor
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
            )}
          </div>
          )}

          <div className="grid min-w-0 gap-6">
            <Card data-testid="card-rfq-register">
              <CardHeader>
                <CardTitle>{isFactory ? "Your assigned ETD work queue" : "Request register"}</CardTitle>
                <CardDescription>
                  {isFactory
                    ? "Internal ETD-only requests assigned to your factory. No pricing is shown."
                    : "TEG group view across four companies and two clusters — grouped by RFQ section."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!isFactory && (
                  <div className="mb-4" data-testid="section-tabs-wrapper">
                    <Tabs
                      value={sectionFilter}
                      onValueChange={(v) => setSectionFilter(v as RfqCategory | "all")}
                    >
                      <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/40 p-1">
                        <TabsTrigger
                          value="all"
                          className="text-xs"
                          data-testid="tab-section-all"
                        >
                          All sections
                          <span className="ml-1.5 rounded bg-background/80 px-1.5 py-0.5 text-[10px] tabular-nums" data-testid="count-section-all">
                            {sectionCounts.all}
                          </span>
                        </TabsTrigger>
                        {visibleCategoriesForTabs.map((cat) => (
                          <TabsTrigger
                            key={cat}
                            value={cat}
                            className="text-xs"
                            data-testid={`tab-section-${cat}`}
                          >
                            {RFQ_CATEGORY_META[cat].shortLabel}
                            <span
                              className="ml-1.5 rounded bg-background/80 px-1.5 py-0.5 text-[10px] tabular-nums"
                              data-testid={`count-section-${cat}`}
                            >
                              {sectionCounts[cat] ?? 0}
                            </span>
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                    {sectionFilter !== "all" && (
                      <p
                        className="mt-2 text-xs text-muted-foreground"
                        data-testid="text-section-helper"
                      >
                        {RFQ_CATEGORY_META[sectionFilter].description}
                      </p>
                    )}
                  </div>
                )}
                <div className="grid gap-3">
                  {filteredRfqs.map((rfq) => (
                    <button
                      key={rfq.id}
                      type="button"
                      onClick={() => setSelectedRfqId(rfq.id)}
                      className={`rounded-xl border p-4 text-left transition hover:bg-accent ${
                        selectedRfqId === rfq.id ? "border-primary bg-primary/5" : "bg-card"
                      }`}
                      data-testid={`button-select-rfq-${rfq.id}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold">{rfq.reference}</p>
                          <p className="text-sm text-muted-foreground">
                            {rfq.category === "manufacturing_subcontractor" && rfq.partnerClient
                              ? `${rfq.partnerClient}${rfq.poCustomerName ? ` · ${rfq.poCustomerName}` : ""}`
                              : rfq.packageName}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="text-[10px]" data-testid={`badge-rfq-section-${rfq.id}`}>
                            {categoryShortLabel(rfq.category)}
                          </Badge>
                          <Badge className={statusClass(rfq.status)}>{statusLabel(rfq.status)}</Badge>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span>{typeLabel(rfq.requestType)}</span>
                        <span>{rfq.clusterName}</span>
                        <span>Target ETD: {rfq.targetEtd}</span>
                        <RfqExpiryCountdown
                          expiresAt={rfq.expiresAt}
                          responseDue={rfq.responseDue}
                          status={rfq.status}
                          testIdSuffix={`rfq-${rfq.id}`}
                        />
                        <DealCloseCountdown
                          dealCloseDue={(rfq as any).dealCloseDue}
                          createdAt={rfq.createdAt}
                          status={rfq.status}
                          testIdSuffix={`rfq-${rfq.id}`}
                        />
                      </div>
                    </button>
                  ))}
                  {!filteredRfqs.length && (
                    <div
                      className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground"
                      data-testid="text-empty-rfqs"
                    >
                      {isFactory
                        ? "No internal ETD requests are assigned to your factory yet."
                        : sectionFilter === "all"
                          ? "No RFQs in this scope yet."
                          : `No ${RFQ_CATEGORY_META[sectionFilter].label} RFQs yet. Create one with the form on the left.`}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {selectedDetail && (
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <CardTitle>
                        {selectedDetail.rfq.category === "manufacturing_subcontractor" && selectedDetail.rfq.partnerClient
                          ? selectedDetail.rfq.partnerClient
                          : selectedDetail.rfq.packageName}
                      </CardTitle>
                      <CardDescription>
                        {selectedDetail.rfq.reference} · {selectedDetail.requestingCompany?.name ?? "TEG"} · {typeLabel(selectedDetail.rfq.requestType)} · <span data-testid="text-detail-section">Section: {categoryLabel(selectedDetail.rfq.category)}</span>
                        {selectedDetail.rfq.category === "manufacturing_subcontractor" && selectedDetail.rfq.poCustomerName && (
                          <> · PO Customer: <span data-testid="text-detail-po-customer">{selectedDetail.rfq.poCustomerName}</span></>
                        )}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={statusClass(selectedDetail.rfq.status)}>{statusLabel(selectedDetail.rfq.status)}</Badge>
                      <RfqExpiryCountdown
                        expiresAt={selectedDetail.rfq.expiresAt}
                        responseDue={selectedDetail.rfq.responseDue}
                        status={selectedDetail.rfq.status}
                        testIdSuffix={`detail-${selectedDetail.rfq.id}`}
                      />
                      <DealCloseCountdown
                        dealCloseDue={(selectedDetail.rfq as any).dealCloseDue}
                        createdAt={selectedDetail.rfq.createdAt}
                        status={selectedDetail.rfq.status}
                        testIdSuffix={`detail-${selectedDetail.rfq.id}`}
                      />
                      {RolePerms.canEditRfq(role, commercialGrant) &&
                        !(selectedDetail.rfq.status === "awarded" || selectedDetail.rfq.status === "accepted" || selectedDetail.rfq.status === "closed") && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setEditOpen((o) => !o)}
                            data-testid="button-edit-rfq"
                          >
                            {editOpen ? "Cancel edit" : "Edit RFQ"}
                          </Button>
                        )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-6">
                  {(() => {
                    const wf = (selectedDetail.rfq.workflowType ??
                      workflowForCategory(selectedDetail.rfq.category)) as WorkflowType;
                    const months = selectedDetail.rfq.priceValidityMonths ?? DEFAULT_PRICE_VALIDITY_MONTHS;
                    let specs: {
                      bagSize?: string;
                      gauge?: string;
                      etdRequired?: string;
                      marketedSize?: { length: string; width: string; height: string };
                      actualSize?: { length: string; width: string; height: string };
                      manufacturing?: { materialSpecification: string; productSize: string; ecLevel: string; productType?: string };
                      productLines?: Array<{
                        productType: string;
                        materialSpecification: string;
                        productSize: string;
                        ecLevel: string;
                        quantity: string;
                        loadabilityPerContainer: string;
                        notes?: string | null;
                        productionSplits?: Array<{ locationName: string; allocation: string; note?: string | null }> | null;
                      }>;
                      productionSplits?: Array<{ locationName: string; allocation: string; note?: string | null }>;
                    } | null = null;
                    if (selectedDetail.rfq.materialSpecs) {
                      try {
                        const parsed = JSON.parse(selectedDetail.rfq.materialSpecs as string);
                        if (parsed && typeof parsed === "object") specs = parsed;
                      } catch {}
                    }
                    const dim = (d?: { length: string; width: string; height: string } | null) =>
                      d ? `${d.length || "—"} × ${d.width || "—"} × ${d.height || "—"}` : "—";
                    const mfg = specs?.manufacturing ?? null;
                    // Build the active product line list. Prefer productLines; otherwise
                    // synthesize one row from legacy `manufacturing` + rfq-level
                    // quantity/unit so older RFQs still display normally.
                    const productLinesList: Array<{
                      productType: string;
                      materialSpecification: string;
                      productSize: string;
                      ecLevel: string;
                      quantity: string;
                      loadabilityPerContainer: string;
                      notes?: string | null;
                      productionSplits?: Array<{ locationName: string; allocation: string; note?: string | null }> | null;
                    }> = (() => {
                      const arr = specs?.productLines;
                      if (Array.isArray(arr) && arr.length > 0) {
                        return arr
                          .filter(
                            (l) => l && (MANUFACTURING_PRODUCT_TYPES as readonly string[]).includes(l.productType),
                          )
                          .map((l) => ({
                            ...l,
                            productionSplits: Array.isArray(l.productionSplits)
                              ? l.productionSplits.filter((r) => r && r.locationName && r.allocation)
                              : null,
                          }));
                      }
                      if (mfg && mfg.materialSpecification && mfg.productSize && mfg.ecLevel) {
                        const pt = (MANUFACTURING_PRODUCT_TYPES as readonly string[]).includes(mfg.productType ?? "")
                          ? (mfg.productType as string)
                          : "growbags";
                        return [
                          {
                            productType: pt,
                            materialSpecification: mfg.materialSpecification,
                            productSize: mfg.productSize,
                            ecLevel: mfg.ecLevel,
                            quantity: selectedDetail.rfq.quantity ?? "",
                            loadabilityPerContainer: selectedDetail.rfq.unit ?? "",
                            notes: null,
                            productionSplits: null,
                          },
                        ];
                      }
                      return [];
                    })();
                    const banners: JSX.Element[] = [];
                    if (wf === "price_validity_inquiry") {
                      banners.push(
                        <div
                          key="validity"
                          className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30"
                          data-testid="banner-detail-price-validity"
                        >
                          <p className="font-semibold text-amber-900 dark:text-amber-200">
                            {months}-month price-validity inquiry
                          </p>
                          <p className="text-amber-900/80 dark:text-amber-200/80">
                            Suppliers submit a unit price valid for {months} months. Acceptance records the price validity — a purchase order is issued later when stock is required.
                          </p>
                        </div>,
                      );
                    }
                    if (wf === "polybag_rfq" && specs) {
                      banners.push(
                        <div
                          key="polybag"
                          className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-3 text-sm dark:border-indigo-900 dark:bg-indigo-950/30"
                          data-testid="banner-detail-polybag"
                        >
                          <p className="font-semibold text-indigo-900 dark:text-indigo-200">
                            Polythene bag inquiry
                          </p>
                          <div className="mt-2 grid gap-1 text-indigo-900/80 dark:text-indigo-200/80 sm:grid-cols-2">
                            <p>
                              <span className="text-xs uppercase tracking-wide">Marketed size (L×W×H)</span><br />
                              <span className="font-medium" data-testid="text-detail-marketed-size">{dim(specs.marketedSize)}</span>
                            </p>
                            <p>
                              <span className="text-xs uppercase tracking-wide">Actual bag size (L×W×H)</span><br />
                              <span className="font-medium" data-testid="text-detail-actual-size">{dim(specs.actualSize)}</span>
                            </p>
                          </div>
                          <p className="mt-2 text-indigo-900/80 dark:text-indigo-200/80">
                            {specs.bagSize ? <>Legacy size note: <span className="font-medium" data-testid="text-detail-bag-size">{specs.bagSize}</span> · </> : null}
                            Gauge: <span className="font-medium" data-testid="text-detail-gauge">{specs.gauge ?? "—"}</span>{" "}
                            · ETD required: <span className="font-medium" data-testid="text-detail-etd-required">{specs.etdRequired ?? "—"}</span>
                          </p>
                        </div>,
                      );
                    }
                    if (productLinesList.length > 0) {
                      banners.push(
                        <div
                          key="mfg"
                          className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/30"
                          data-testid="banner-detail-manufacturing"
                        >
                          <p className="font-semibold text-emerald-900 dark:text-emerald-200">
                            Products in this RFQ ({productLinesList.length})
                          </p>
                          <ul className="mt-2 grid gap-3" data-testid="list-detail-product-lines">
                            {productLinesList.map((line, idx) => {
                              const ptKey = line.productType as ManufacturingProductType | "";
                              const ptMeta = ptKey && (MANUFACTURING_PRODUCT_TYPES as readonly string[]).includes(ptKey)
                                ? MANUFACTURING_PRODUCT_TYPE_META[ptKey as ManufacturingProductType]
                                : null;
                              const sizeLabel = ptMeta?.sizeLabel ?? "Product size";
                              return (
                                <li
                                  key={idx}
                                  className="rounded-lg border border-emerald-200/60 bg-card/60 p-3 text-emerald-900/90 dark:border-emerald-900/40 dark:bg-card/40 dark:text-emerald-100/90"
                                  data-testid={`row-detail-product-line-${idx}`}
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-sm font-semibold">
                                      {idx + 1}. {ptMeta?.label ?? line.productType}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {line.quantity} · Loadability: {line.loadabilityPerContainer}/container
                                    </p>
                                  </div>
                                  <div className="mt-2 grid gap-1 text-xs sm:grid-cols-3">
                                    <p>
                                      <span className="uppercase tracking-wide text-muted-foreground">Material</span><br />
                                      <span className="font-medium" data-testid={`text-detail-product-line-material-${idx}`}>
                                        {line.materialSpecification}
                                      </span>
                                    </p>
                                    <p>
                                      <span className="uppercase tracking-wide text-muted-foreground">{sizeLabel}</span><br />
                                      <span className="font-medium" data-testid={`text-detail-product-line-size-${idx}`}>
                                        {line.productSize}
                                      </span>
                                    </p>
                                    <p>
                                      <span className="uppercase tracking-wide text-muted-foreground">EC level</span><br />
                                      <span className="font-medium" data-testid={`text-detail-product-line-ec-${idx}`}>
                                        {line.ecLevel}
                                      </span>
                                    </p>
                                  </div>
                                  {line.notes ? (
                                    <p className="mt-2 text-xs text-muted-foreground" data-testid={`text-detail-product-line-notes-${idx}`}>
                                      Notes: {line.notes}
                                    </p>
                                  ) : null}
                                  {Array.isArray(line.productionSplits) && line.productionSplits.length >= 2 ? (
                                    <div
                                      className="mt-2 rounded-md border border-sky-200 bg-sky-50/60 p-2 text-xs dark:border-sky-900 dark:bg-sky-950/30"
                                      data-testid={`row-detail-product-line-splits-${idx}`}
                                    >
                                      <p className="flex items-center gap-1 font-semibold text-sky-900 dark:text-sky-200">
                                        <Split className="h-3.5 w-3.5" /> Split across {line.productionSplits.length} locations
                                      </p>
                                      <ul className="mt-1 grid gap-0.5 text-sky-900/80 dark:text-sky-200/80">
                                        {line.productionSplits.map((row, sidx) => (
                                          <li
                                            key={sidx}
                                            className="flex flex-wrap gap-x-2"
                                            data-testid={`text-detail-product-line-split-${idx}-${sidx}`}
                                          >
                                            <span className="font-medium">{row.locationName}</span>
                                            <span>— {row.allocation}</span>
                                            {row.note ? <span className="text-muted-foreground">({row.note})</span> : null}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        </div>,
                      );
                    }
                    // Legacy RFQ-level splits. Only shown when no product line carries
                    // its own split — newer RFQs put splits on each product line and
                    // we render those inline above.
                    const anyLineSplit = productLinesList.some(
                      (l) => Array.isArray(l.productionSplits) && (l.productionSplits as Array<{ locationName: string; allocation: string }>).length >= 2,
                    );
                    const legacySplits = Array.isArray(specs?.productionSplits)
                      ? (specs!.productionSplits as Array<{ locationName: string; allocation: string; note?: string | null }>).filter(
                          (r) => r && r.locationName && r.allocation,
                        )
                      : [];
                    if (!anyLineSplit && legacySplits.length >= 2) {
                      banners.push(
                        <div
                          key="splits"
                          className="rounded-xl border border-sky-200 bg-sky-50/40 p-3 text-sm dark:border-sky-900 dark:bg-sky-950/30"
                          data-testid="banner-detail-splits"
                        >
                          <p className="flex items-center gap-2 font-semibold text-sky-900 dark:text-sky-200">
                            <Split className="h-4 w-4" /> Legacy RFQ-level production split across {legacySplits.length} locations
                          </p>
                          <ul className="mt-2 grid gap-1 text-sky-900/80 dark:text-sky-200/80">
                            {legacySplits.map((row, idx) => (
                              <li key={idx} className="flex flex-wrap gap-x-2" data-testid={`text-detail-split-${idx}`}>
                                <span className="font-medium">{row.locationName}</span>
                                <span>— {row.allocation}</span>
                                {row.note ? <span className="text-muted-foreground">({row.note})</span> : null}
                              </li>
                            ))}
                          </ul>
                          <p className="mt-2 text-[11px] text-sky-900/70 dark:text-sky-200/70">
                            Open Edit RFQ to migrate this split onto a specific product line.
                          </p>
                        </div>,
                      );
                    }
                    return banners.length ? <>{banners}</> : null;
                  })()}

                  {editOpen && selectedDetail && (
                    <EditRfqPanel
                      rfq={selectedDetail.rfq}
                      hasInvites={selectedDetail.invites.length > 0}
                      isPending={editRfq.isPending}
                      onCancel={() => setEditOpen(false)}
                      onSubmit={(patch) => editRfq.mutate(patch)}
                    />
                  )}
                  <div className="grid gap-3 rounded-xl border bg-card/70 p-4 md:grid-cols-4">
                    <div>
                      <Label>Cluster</Label>
                      <p className="mt-1 text-sm">{selectedDetail.rfq.clusterName}</p>
                    </div>
                    <div>
                      <Label>Price visibility</Label>
                      <p className="mt-1 flex items-center gap-2 text-sm">
                        {selectedDetail.rfq.priceVisibility === "hidden" && <ShieldOff className="h-4 w-4" />}
                        {selectedDetail.rfq.priceVisibility}
                      </p>
                    </div>
                    <div>
                      <Label>Quantity</Label>
                      <p className="mt-1 text-sm">
                        {selectedDetail.rfq.quantity}{" "}
                        {(selectedDetail.rfq.category ?? "manufacturing_subcontractor") === "manufacturing_subcontractor"
                          ? <span className="text-muted-foreground">· Loadability: {selectedDetail.rfq.unit}</span>
                          : selectedDetail.rfq.unit}
                      </p>
                    </div>
                    <div>
                      <Label>Target ETD</Label>
                      <p className="mt-1 text-sm">{selectedDetail.rfq.targetEtd}</p>
                    </div>
                    {(selectedDetail.rfq.category ?? "manufacturing_subcontractor") === "manufacturing_subcontractor" ? (
                      <>
                        <div className="md:col-span-2" data-testid="text-rfq-partner-client">
                          <Label>Partner / Client</Label>
                          <p className="mt-1 text-sm">
                            {selectedDetail.rfq.partnerClient || (
                              <span className="text-muted-foreground">Not recorded</span>
                            )}
                          </p>
                        </div>
                        <div data-testid="text-rfq-po-country">
                          <Label>Country</Label>
                          <p className="mt-1 text-sm">
                            {selectedDetail.rfq.poCountry || (
                              <span className="text-muted-foreground">Not recorded</span>
                            )}
                          </p>
                        </div>
                        <div data-testid="text-rfq-po-customer-name">
                          <Label>Customer stated on PO</Label>
                          <p className="mt-1 text-sm">
                            {selectedDetail.rfq.poCustomerName || (
                              <span className="text-muted-foreground">Not recorded</span>
                            )}
                          </p>
                        </div>
                      </>
                    ) : (
                      <div className="md:col-span-4">
                        <Label>Scope</Label>
                        <p className="mt-1 text-sm text-muted-foreground">{selectedDetail.rfq.description}</p>
                      </div>
                    )}
                  </div>

                  {/* Document requirement checklist for Product Manufacturing.
                      Boolean-only — never leaks filenames. Visible to internal
                      decision roles + Platform Admin (status only, no docs). */}
                  {(isAdmin || isCommercial || isCommercialManager || isPlatformAdmin) && (
                    <DocumentRequirementChecklist rfqId={selectedDetail.rfq.id} />
                  )}

                  {isAdmin && (
                    <RfqDocumentsPanel
                      rfqId={selectedDetail.rfq.id}
                      rfqReference={selectedDetail.rfq.reference}
                      isAdmin={isAdmin}
                    />
                  )}

                  {/* Internal-only quote comparison. Senior management, commercial
                      manager, and commercial staff (within scope) see vendor-by-vendor
                      data. Factory users and Platform Admin do not see it (Platform
                      Admin sees audit/technical, not commercial decision data). */}
                  {(isAdmin || isCommercial || isCommercialManager) &&
                    selectedDetail.invites.length > 0 && (
                      <QuoteComparisonTable
                        invites={selectedDetail.invites}
                        awardedInviteId={selectedDetail.rfq.awardedInviteId ?? null}
                      />
                    )}

                  {/* Amendment / version history. Internal-full view only. */}
                  {(isAdmin || isCommercial || isCommercialManager || isPlatformAdmin) && (
                    <AmendmentHistoryPanel rfqId={selectedDetail.rfq.id} />
                  )}

                  {(isAdmin || isCommercial || isCommercialManager) && (
                    <AdminRecommendationReviewPanel
                      rfqId={selectedDetail.rfq.id}
                      invitesById={
                        new Map<number, RecommendationInvite>(
                          selectedDetail.invites.map((inv) => [
                            inv.id,
                            {
                              id: inv.id,
                              recipientName: inv.recipientName,
                              status: inv.status,
                              currentPrice: inv.currentPrice ?? null,
                              currentEtd: inv.currentEtd ?? null,
                              priceVisibility: inv.priceVisibility,
                            },
                          ]),
                        )
                      }
                    />
                  )}

                  <NotificationCenter rfqId={selectedDetail.rfq.id} variant="inline" />

                  {(isAdmin || isCommercial || isCommercialManager) && (
                    <AuditTrailPanel rfqId={selectedDetail.rfq.id} variant="card" limit={50} />
                  )}

                  {pendingRecommendation && !isAdmin && (
                    <div
                      className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50/50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/20"
                      data-testid="banner-pending-recommendation"
                    >
                      <RecommendationStatusBadge
                        status={pendingRecommendation.status}
                        testIdSuffix={`banner-${pendingRecommendation.id}`}
                      />
                      <span>
                        Awaiting Senior Management decision on recommendation for{" "}
                        <strong>
                          {selectedDetail.invites.find((inv) => inv.id === pendingRecommendation.inviteId)?.recipientName ??
                            "a recipient"}
                        </strong>
                        .
                      </span>
                    </div>
                  )}

                  {canSendInvite && (
                  <div
                    className={`grid gap-4 rounded-xl border bg-background p-4 ${
                      selectedRfqCategory === "manufacturing_subcontractor" ? "lg:grid-cols-2" : ""
                    }`}
                    data-testid="region-send-invites"
                  >
                    <div className="grid gap-3">
                      <div className="flex items-center gap-2">
                        <Globe2 className="h-4 w-4 text-muted-foreground" />
                        <h2 className="text-lg font-semibold" data-testid="text-vendor-picker-title">
                          {selectedRfqCategory === "manufacturing_subcontractor"
                            ? "Send outside to manufacturing subcontractor"
                            : `Send to ${RFQ_CATEGORY_META[selectedRfqCategory].vendorNoun}`}
                        </h2>
                      </div>
                      <p className="text-xs text-muted-foreground" data-testid="text-vendor-picker-help">
                        {selectedRfqCategory === "manufacturing_subcontractor"
                          ? "Only manufacturing subcontractors are listed for this section. Filter by country, then tick one or more recipients to send to all at once."
                          : `Only suppliers whose categories include ${RFQ_CATEGORY_META[selectedRfqCategory].label} are listed. Filter by country, then tick one or more recipients to send to all at once.`}
                      </p>

                      <div className="grid gap-2 sm:grid-cols-[200px_1fr]">
                        <Select value={bulkCountry} onValueChange={(v) => setBulkCountry(v as typeof bulkCountry)}>
                          <SelectTrigger data-testid="select-bulk-country">
                            <SelectValue placeholder="Country filter" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All countries</SelectItem>
                            <SelectItem value="Sri Lanka">Sri Lanka</SelectItem>
                            <SelectItem value="India">India</SelectItem>
                            <SelectItem value="Indonesia">Indonesia</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="self-center text-xs text-muted-foreground" data-testid="text-bulk-selected-count">
                          {bulkSelected.size === 0
                            ? `${vendorsForBulkPicker.length} vendor${vendorsForBulkPicker.length === 1 ? "" : "s"} listed`
                            : `${bulkSelected.size} selected of ${vendorsForBulkPicker.length} listed`}
                        </p>
                      </div>

                      <div
                        className="max-h-64 overflow-y-auto rounded-lg border bg-card"
                        data-testid="list-bulk-vendors"
                      >
                        {vendorsForBulkPicker.length === 0 && (
                          <div
                            className="px-3 py-3 text-xs text-muted-foreground"
                            data-testid="text-no-vendors-for-category"
                          >
                            No vendors registered for this section / country combination.
                          </div>
                        )}
                        {vendorsForBulkPicker.map((sub) => {
                          const checked = bulkSelected.has(sub.id);
                          const blocked = sub.country === "India" && (INDIA_BLOCKED_REQUESTING_COMPANY_CODES as readonly string[]).includes(requestingCode);
                          return (
                            <label
                              key={sub.id}
                              className={`flex items-start gap-3 border-b px-3 py-2 last:border-b-0 ${blocked ? "opacity-60" : "hover:bg-accent"}`}
                              data-testid={`row-bulk-vendor-${sub.id}`}
                            >
                              <Checkbox
                                checked={checked}
                                disabled={blocked}
                                onCheckedChange={(v) => {
                                  setBulkResult(null);
                                  setBulkSelected((prev) => {
                                    const next = new Set(prev);
                                    if (v) next.add(sub.id);
                                    else next.delete(sub.id);
                                    return next;
                                  });
                                }}
                                className="mt-1"
                                data-testid={`checkbox-bulk-vendor-${sub.id}`}
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium" data-testid={`text-bulk-vendor-name-${sub.id}`}>
                                  {sub.name}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  {sub.country} · {clusterAccessLabel(sub.clusterAccess)}{blocked ? " · blocked by India routing rule" : ""}
                                </p>
                              </div>
                            </label>
                          );
                        })}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={vendorsForBulkPicker.length === 0}
                            onClick={() =>
                              setBulkSelected(new Set(vendorsForBulkPicker.filter((s) => !(s.country === "India" && (INDIA_BLOCKED_REQUESTING_COMPANY_CODES as readonly string[]).includes(requestingCode))).map((s) => s.id)))
                            }
                            data-testid="button-bulk-select-all"
                          >
                            Select all
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={bulkSelected.size === 0}
                            onClick={() => setBulkSelected(new Set())}
                            data-testid="button-bulk-clear"
                          >
                            Clear
                          </Button>
                        </div>
                        <Button
                          type="button"
                          disabled={bulkSelected.size === 0 || bulkSend.isPending}
                          onClick={() => {
                            setRoutingError(null);
                            setBulkResult(null);
                            bulkSend.mutate({
                              country: bulkCountry === "all" ? null : bulkCountry,
                              subcontractorIds: Array.from(bulkSelected),
                            });
                          }}
                          data-testid="button-bulk-send"
                        >
                          <Send className="mr-2 h-4 w-4" />
                          Send RFQ to {bulkSelected.size || 0} selected
                        </Button>
                      </div>

                      {bulkResult && (
                        <div
                          className={`rounded-lg border p-3 text-xs ${
                            bulkResult.failures.length === 0
                              ? "border-emerald-300 bg-emerald-50/60 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                              : "border-amber-300 bg-amber-50/60 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                          }`}
                          data-testid="text-bulk-result"
                        >
                          <p className="font-semibold">
                            Bulk send: {bulkResult.successes} sent, {bulkResult.failures.length} failed.
                          </p>
                          {bulkResult.failures.length > 0 && (
                            <ul className="mt-1 list-disc pl-5">
                              {bulkResult.failures.map((f) => {
                                const v = subcontractors.data?.find((s) => s.id === f.id);
                                return (
                                  <li key={f.id} data-testid={`text-bulk-failure-${f.id}`}>
                                    {v?.name ?? `Vendor ${f.id}`}: {f.message}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      )}

                      {routingError && (
                        <div
                          className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
                          data-testid="text-india-routing-blocked"
                        >
                          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                          <span>{routingError}</span>
                        </div>
                      )}
                    </div>

                    {selectedRfqCategory === "manufacturing_subcontractor" && (
                    <div className="grid gap-3">
                      <div className="flex items-center gap-2">
                        <Factory className="h-4 w-4 text-muted-foreground" />
                        <h2 className="text-lg font-semibold">Send ETD-only to factory</h2>
                      </div>
                      <div className="flex gap-2">
                        <Select value={internalFactory} onValueChange={setInternalFactory}>
                          <SelectTrigger data-testid="select-internal-factory">
                            <SelectValue placeholder="Choose internal factory" />
                          </SelectTrigger>
                          <SelectContent>
                            {factories.data?.map((factory) => (
                              <SelectItem key={factory.id} value={String(factory.id)}>
                                {factory.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!internalFactory || sendInvite.isPending}
                          onClick={() =>
                            sendInvite.mutate({
                              recipientType: "internal_factory",
                              factoryId: Number(internalFactory),
                            })
                          }
                          data-testid="button-send-internal-etd"
                        >
                          <Clock3 className="mr-2 h-4 w-4" />
                          Send ETD
                        </Button>
                      </div>
                    </div>
                    )}
                  </div>
                  )}

                  {canEscalate && hasInternalInvite && (
                    <div className="grid gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/30">
                      <div>
                        <h2 className="text-lg font-semibold">Internal ETD fallback</h2>
                        <p className="text-sm text-muted-foreground">
                          If an internal factory ETD is not favourable, send the same inquiry outside as a commercial subcontractor RFQ.
                        </p>
                      </div>
                      <div className="grid gap-3 md:grid-cols-[280px_1fr_auto]">
                        <Select value={escalationSubcontractor} onValueChange={(v) => { setEscalationSubcontractor(v); setRoutingError(null); }}>
                          <SelectTrigger data-testid="select-escalation-subcontractor">
                            <SelectValue placeholder="External subcontractor" />
                          </SelectTrigger>
                          <SelectContent>
                            {vendorsForSelectedRfq.map((subcontractor) => (
                              <SelectItem key={subcontractor.id} value={String(subcontractor.id)}>
                                {subcontractor.name} · {subcontractor.country} · {clusterAccessLabel(subcontractor.clusterAccess)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          value={escalationReason}
                          onChange={(event) => setEscalationReason(event.target.value)}
                          placeholder="Reason, e.g. internal ETD misses customer date"
                          data-testid="input-escalation-reason"
                        />
                        <Button
                          type="button"
                          disabled={
                            !escalationSubcontractor ||
                            !escalationReason ||
                            escalate.isPending ||
                            escalationIndiaBlocked
                          }
                          onClick={() => {
                            if (escalationIndiaBlocked) {
                              setRoutingError(INDIA_BLOCKED_MESSAGE);
                              return;
                            }
                            setRoutingError(null);
                            escalate.mutate();
                          }}
                          data-testid="button-escalate-external"
                        >
                          <Globe2 className="mr-2 h-4 w-4" />
                          Escalate outside
                        </Button>
                      </div>
                      {escalationIndiaBlocked && (
                        <div
                          className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
                          data-testid="text-india-routing-blocked-escalate"
                        >
                          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                          <span>{INDIA_BLOCKED_MESSAGE}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {(() => {
                    const awardedInviteId = selectedDetail.rfq.awardedInviteId ?? null;
                    const isClosedInvite = (s: string) =>
                      s === "closed" || s === "declined";
                    const isAwardedInvite = (inv: Invite) =>
                      inv.id === awardedInviteId || inv.status === "accepted" || inv.status === "awarded";
                    const activeInvites = selectedDetail.invites.filter(
                      (inv) => !isClosedInvite(inv.status) && !isAwardedInvite(inv),
                    );
                    const awardedInvites = selectedDetail.invites.filter(isAwardedInvite);
                    const closedInvites = selectedDetail.invites.filter(
                      (inv) => isClosedInvite(inv.status) && !isAwardedInvite(inv),
                    );

                    const renderInviteCard = (invite: Invite, options: { dimmed?: boolean } = {}) => {
                      const portalPath = `${window.location.origin}${window.location.pathname}#/portal/${invite.token}`;
                      const priceVisible = invite.priceVisibility === "visible";
                      const isWinner = invite.id === awardedInviteId || invite.status === "accepted" || invite.status === "awarded";
                      const isClosed = isClosedInvite(invite.status);
                      return (
                        <article
                          key={invite.id}
                          className={`grid gap-4 rounded-2xl border bg-card p-5 ${options.dimmed ? "opacity-70" : ""}`}
                          data-testid={`card-invite-${invite.id}`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <h2 className="text-lg font-semibold">{invite.recipientName}</h2>
                                <Badge variant="outline">{recipientLabel(invite.recipientType)}</Badge>
                                <Badge className={statusClass(invite.status)}>{statusLabel(invite.status)}</Badge>
                                {isWinner && (
                                  <Badge
                                    className="bg-emerald-600 text-white"
                                    data-testid={`badge-awarded-${invite.id}`}
                                  >
                                    <Award className="mr-1 h-3 w-3" /> Awarded
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {invite.recipientContact} · {invite.recipientEmail} · {invite.country}
                              </p>
                            </div>
                            <div className="text-right text-sm">
                              <p className="font-semibold tabular-nums">
                                {isFactory || !priceVisible ? "Price hidden" : formatPrice(invite.currentPrice)}
                              </p>
                              <p className="text-muted-foreground">ETD: {invite.currentEtd ?? "Awaiting response"}</p>
                            </div>
                          </div>
                          {isClosed && invite.closureReason && (
                            <div
                              className="rounded-xl border border-rose-200 bg-rose-50/60 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200"
                              data-testid={`text-closure-reason-${invite.id}`}
                            >
                              <span className="font-medium">Closure reason: </span>
                              {invite.closureReason}
                            </div>
                          )}
                          {!isFactory && (
                            <div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
                              Recipient portal: <span className="break-all font-medium text-foreground">{portalPath}</span>
                            </div>
                          )}
                          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                            <ScrollArea className="h-[260px] rounded-xl border p-4">
                              <Timeline negotiations={invite.negotiations} priceVisible={priceVisible && !isFactory} />
                            </ScrollArea>
                            {isFactory ? (
                              <FactoryControls invite={invite} rfqId={selectedDetail.rfq.id} />
                            ) : canBuyerNegotiate && !isClosed && !isWinner ? (
                              <div className="grid gap-3">
                                <BuyerControls
                                  invite={invite}
                                  rfqId={selectedDetail.rfq.id}
                                  canAcceptOrAward={canAcceptOrAward}
                                  isCommercial={isCommercial}
                                  hasOpenRecommendation={hasOpenRecommendation}
                                  workflowType={
                                    (selectedDetail.rfq.workflowType ??
                                      workflowForCategory(selectedDetail.rfq.category)) as WorkflowType
                                  }
                                  priceValidityMonths={selectedDetail.rfq.priceValidityMonths ?? null}
                                />
                                {isCommercial && commercialGrant && (
                                  <CommercialRecommendationForm
                                    rfqId={selectedDetail.rfq.id}
                                    invite={{
                                      id: invite.id,
                                      recipientName: invite.recipientName,
                                      status: invite.status,
                                      currentPrice: invite.currentPrice ?? null,
                                      currentEtd: invite.currentEtd ?? null,
                                      priceVisibility: invite.priceVisibility,
                                    }}
                                    hasOpenRecommendation={hasOpenRecommendation}
                                  />
                                )}
                              </div>
                            ) : null}
                          </div>
                        </article>
                      );
                    };

                    return (
                      <div className="grid gap-6">
                        {awardedInvites.length > 0 && (
                          <section className="grid gap-3" data-testid="section-awarded-rfqs">
                            <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                              <Award className="h-4 w-4" /> Awarded
                            </h3>
                            <div className="grid gap-4">
                              {awardedInvites.map((inv) => renderInviteCard(inv))}
                            </div>
                          </section>
                        )}
                        {activeInvites.length > 0 && (
                          <section className="grid gap-3" data-testid="section-active-invites">
                            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                              Active
                            </h3>
                            <div className="grid gap-4">
                              {activeInvites.map((inv) => renderInviteCard(inv))}
                            </div>
                          </section>
                        )}
                        {closedInvites.length > 0 && (
                          <section className="grid gap-3" data-testid="section-closed-invites">
                            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                              Closed (non-winning)
                            </h3>
                            <div className="grid gap-4">
                              {closedInvites.map((inv) => renderInviteCard(inv, { dimmed: true }))}
                            </div>
                          </section>
                        )}
                      </div>
                    );
                  })()}
                  {!selectedDetail.invites.length && (
                    <div className="rounded-2xl border border-dashed p-8 text-center">
                      <Building2 className="mx-auto h-8 w-8 text-muted-foreground" />
                      <h2 className="mt-3 text-lg font-semibold">No recipients yet</h2>
                      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                        Send this request to an internal factory for ETD-only confirmation or outside to an external subcontractor.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
