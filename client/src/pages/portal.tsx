import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Award, Bell, CheckCircle2, Inbox, Lock, Mail, MailOpen, Send, ShieldOff, XCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useForm } from "react-hook-form";
import { Link, useRoute } from "wouter";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatUSD } from "@shared/lib";
import { PortalAmendmentHistory } from "@/components/amendment-history-panel";

type Negotiation = {
  id: number;
  actor: "buyer" | "subcontractor" | "factory";
  action: string;
  price?: number | null;
  etd?: string | null;
  note: string;
  createdAt: string;
};

type PortalDetail = {
  rfq: {
    id: number;
    reference: string;
    requestType: "external_rfq" | "internal_etd" | "intercompany";
    category?: string;
    workflowType?: "standard_rfq" | "price_validity_inquiry" | "polybag_rfq";
    priceValidityMonths?: number | null;
    materialSpecs?: string;
    projectName: string;
    packageName: string;
    description: string;
    quantity: string;
    unit: string;
    targetEtd: string;
    responseDue: string;
    status: string;
    clusterName: string;
    priceVisibility: "visible" | "hidden";
    negotiationScope: "price_etd" | "etd_only";
    // Product Manufacturing PO context. Surfaced to recipients so they know the
    // commercial origin of the order. The PO document itself is never sent.
    partnerClient?: string | null;
    poCountry?: string | null;
    poCustomerName?: string | null;
  };
  invites: Array<{
    id: number;
    recipientType: "external_subcontractor" | "internal_factory" | "internal_company";
    priceVisibility: "visible" | "hidden";
    negotiationScope: "price_etd" | "etd_only";
    status: string;
    currentPrice?: number | null;
    currentEtd?: string | null;
    closureReason?: string | null;
    closedAt?: string | null;
    recipientName: string;
    recipientContact: string;
    recipientEmail: string;
    subcontractor?: { name: string; contactName: string; email: string; specialty: string } | null;
    factory?: { name: string; location: string; country: string } | null;
    company?: { name: string; clusterName: string } | null;
    negotiations: Negotiation[];
  }>;
};

const externalSchema = z.object({
  price: z.coerce.number().int().positive("Price (USD) required"),
  etd: z.string().min(1, "ETD / delivery date required"),
  note: z.string().min(3, "Add a note for the TEG team"),
});

const internalSchema = z.object({
  etd: z.string().min(1, "ETD is required"),
  note: z.string().min(3, "Add a note for the TEG team"),
});

// All TEG amounts are USD.
function formatPrice(value?: number | null) {
  if (!value) return "No price submitted";
  return formatUSD(value);
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function statusClass(status: string) {
  if (status === "accepted" || status === "awarded")
    return "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200";
  if (status === "declined" || status === "closed")
    return "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200";
  if (status === "under_negotiation" || status === "quoted")
    return "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-200";
  return "bg-secondary text-secondary-foreground";
}

export default function Portal() {
  const [, params] = useRoute("/portal/:token");
  const token = params?.token ?? "";

  const detail = useQuery<PortalDetail>({
    queryKey: ["/api/portal", token],
    enabled: Boolean(token),
  });

  type PortalNotification = {
    id: number;
    rfqId: number;
    inviteId: number | null;
    notificationType:
      | "rfq_sent"
      | "quote_received"
      | "recommendation_pending"
      | "award_approved"
      | "award_closure";
    audience: "admin_internal" | "admin_buyer_commercial" | "factory" | "subcontractor_invite";
    recipientLabel: string;
    subject: string;
    body: string;
    createdAt: string;
    isRead: boolean;
  };

  const portalNotifications = useQuery<PortalNotification[]>({
    queryKey: ["/api/portal", token, "notifications"],
    enabled: Boolean(token),
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/portal/${token}/notifications`);
      return res.json();
    },
  });

  const markPortalRead = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/portal/${token}/notifications/${id}/read`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal", token, "notifications"] });
    },
  });

  const invite = detail.data?.invites[0];
  const isHidden = invite?.priceVisibility === "hidden";
  const isInternal = invite?.recipientType !== "external_subcontractor";
  const actor: "subcontractor" | "factory" = isInternal ? "factory" : "subcontractor";

  const externalForm = useForm<z.infer<typeof externalSchema>>({
    resolver: zodResolver(externalSchema),
    values: {
      price: invite?.currentPrice ?? 1,
      etd: invite?.currentEtd ?? "",
      note: "",
    },
  });

  const internalForm = useForm<z.infer<typeof internalSchema>>({
    resolver: zodResolver(internalSchema),
    values: {
      etd: invite?.currentEtd ?? "",
      note: "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (payload: {
      action: "quote" | "counter" | "accept" | "decline";
      price?: number;
      etd?: string;
      note: string;
    }) => {
      if (!invite) return undefined;
      const response = await apiRequest("POST", `/api/invites/${invite.id}/negotiations`, {
        ...payload,
        actor,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal", token] });
      externalForm.reset({ price: invite?.currentPrice ?? 1, etd: invite?.currentEtd ?? "", note: "" });
      internalForm.reset({ etd: invite?.currentEtd ?? "", note: "" });
    },
  });

  if (detail.isLoading) {
    return (
      <main className="min-h-screen bg-background p-6">
        <div className="mx-auto grid max-w-4xl gap-4">
          <div className="h-16 animate-pulse rounded-xl bg-muted" />
          <div className="h-96 animate-pulse rounded-2xl bg-muted" />
        </div>
      </main>
    );
  }

  if (!detail.data || !invite) {
    // The server returns 410 with a structured message for revoked / expired tokens. Surface it.
    const errMessage =
      detail.error instanceof Error ? detail.error.message : "";
    const expiredOrRevoked = errMessage.includes("revoked") || errMessage.includes("expired");
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle data-testid="text-portal-unavailable">
              {expiredOrRevoked ? "This portal link is no longer valid" : "RFQ invitation not found"}
            </CardTitle>
            <CardDescription>
              {expiredOrRevoked
                ? errMessage
                : "The link may be incorrect or the RFQ is no longer available."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/" data-testid="link-return-dashboard">
                Return to dashboard
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const isAccepted = invite.status === "accepted" || invite.status === "awarded";
  const isClosed = invite.status === "closed" || invite.status === "declined";
  const disabled = isAccepted || isClosed;
  const primaryAction: "quote" | "counter" = invite.currentEtd || invite.currentPrice ? "counter" : "quote";

  // Hoisted up here so the closing tag below can still rely on it.
  const rfqCategory = (detail.data.rfq.category ?? "manufacturing_subcontractor") as string;
  const isSupplierRfq = !isInternal && rfqCategory !== "manufacturing_subcontractor";
  const supplierLabelByCategory: Record<string, string> = {
    wooden_pallets: "Wooden Pallets",
    polythene_bags: "Polythene Bags",
    cardboard: "Cardboard / Cartons",
    packaging_materials: "Packaging Materials",
    logistics_shipping: "Logistics / Shipping",
    other_supplies: "Other Suppliers",
  };
  const supplierCategoryLabel = supplierLabelByCategory[rfqCategory] ?? "Supplier";
  // Workflow detection — derive from server-provided workflowType when present, else from
  // category. Keeps the portal copy honest about whether this is a normal RFQ, a 6-month
  // price-validity inquiry, or a polythene-bag specs inquiry.
  const workflowType = detail.data.rfq.workflowType
    ?? (rfqCategory === "wooden_pallets" || rfqCategory === "cardboard"
      ? "price_validity_inquiry"
      : rfqCategory === "polythene_bags"
        ? "polybag_rfq"
        : "standard_rfq");
  const isPriceValidity = workflowType === "price_validity_inquiry";
  const isPolybag = workflowType === "polybag_rfq";
  // External vendor responses for Product Manufacturing and Polythene Bags must include
  // BOTH price and ETD on every quote/counter. Internal hidden-price ETD-only flows are
  // unaffected. Cardboard / wooden pallets / other supplier categories keep their existing
  // behavior for now.
  const bothRequired =
    !isInternal &&
    (rfqCategory === "manufacturing_subcontractor" || rfqCategory === "polythene_bags");
  const priceValidityMonths = detail.data.rfq.priceValidityMonths ?? 6;
  const polybagSpecs: {
    bagSize?: string;
    gauge?: string;
    etdRequired?: string;
    marketedSize?: { length: string; width: string; height: string };
    actualSize?: { length: string; width: string; height: string };
  } | null = (() => {
    if (!detail.data.rfq.materialSpecs) return null;
    try {
      const parsed = JSON.parse(detail.data.rfq.materialSpecs);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}
    return null;
  })();
  const manufacturingSpecs: {
    materialSpecification: string;
    productSize: string;
    ecLevel: string;
    productType?: string | null;
  } | null = (() => {
    if (!detail.data.rfq.materialSpecs) return null;
    try {
      const parsed = JSON.parse(detail.data.rfq.materialSpecs);
      const m = parsed?.manufacturing;
      if (m && typeof m === "object" && m.materialSpecification && m.productSize && m.ecLevel) return m;
    } catch {}
    return null;
  })();
  // Multi-product Product Manufacturing lines. Falls back to a single line synthesized
  // from legacy `manufacturing` + rfq quantity/unit so older RFQs still render.
  const portalProductLines: Array<{
    productType: string;
    materialSpecification: string;
    productSize: string;
    ecLevel: string;
    quantity: string;
    loadabilityPerContainer: string;
    notes?: string | null;
    productionSplits?: Array<{ locationName: string; allocation: string; note?: string | null }> | null;
  }> = (() => {
    if (!detail.data.rfq.materialSpecs) return [];
    try {
      const parsed = JSON.parse(detail.data.rfq.materialSpecs);
      const arr = parsed?.productLines;
      if (Array.isArray(arr) && arr.length > 0) {
        return arr
          .filter(
            (l: any) =>
              l && typeof l === "object" && typeof l.productType === "string" &&
              l.materialSpecification && l.productSize && l.ecLevel && l.quantity && l.loadabilityPerContainer,
          )
          .map((l: any) => ({
            productType: l.productType,
            materialSpecification: l.materialSpecification,
            productSize: l.productSize,
            ecLevel: l.ecLevel,
            quantity: l.quantity,
            loadabilityPerContainer: l.loadabilityPerContainer,
            notes: l.notes ?? null,
            productionSplits: Array.isArray(l.productionSplits)
              ? l.productionSplits.filter(
                  (r: any) => r && typeof r === "object" && r.locationName && r.allocation,
                )
              : null,
          }));
      }
      const m = parsed?.manufacturing;
      if (m && m.materialSpecification && m.productSize && m.ecLevel) {
        return [
          {
            productType: m.productType ?? "growbags",
            materialSpecification: m.materialSpecification,
            productSize: m.productSize,
            ecLevel: m.ecLevel,
            quantity: detail.data.rfq.quantity ?? "",
            loadabilityPerContainer: detail.data.rfq.unit ?? "",
            notes: null,
            productionSplits: null,
          },
        ];
      }
    } catch {}
    return [];
  })();
  // Legacy RFQ-level splits — newer RFQs carry splits per product line and we render
  // those under the matching product card below. We only surface the legacy banner
  // when no product line has its own split.
  const productionSplits: Array<{ locationName: string; allocation: string; note?: string | null }> = (() => {
    if (!detail.data.rfq.materialSpecs) return [];
    try {
      const parsed = JSON.parse(detail.data.rfq.materialSpecs);
      const arr = parsed?.productionSplits;
      if (!Array.isArray(arr)) return [];
      return arr.filter((r: any) => r && typeof r === "object" && r.locationName && r.allocation);
    } catch {
      return [];
    }
  })();
  const anyLineSplit = portalProductLines.some(
    (l) => Array.isArray(l.productionSplits) && (l.productionSplits as Array<{ locationName: string; allocation: string }>).length >= 2,
  );
  // Friendly product-type labels for portal display.
  const productTypeMeta: Record<string, { label: string; sizeLabel: string; sizeHelp: string }> = {
    growbags: { label: "Growbags", sizeLabel: "Product size", sizeHelp: "Bag dimensions." },
    grow_pots: { label: "Grow pots", sizeLabel: "Product size", sizeHelp: "Pot dimensions or volume." },
    bales_blocks: { label: "Bales / Blocks", sizeLabel: "Weight", sizeHelp: "Unit weight." },
    baggers: { label: "Baggers", sizeLabel: "Weight", sizeHelp: "Unit weight." },
  };
  const portalProductTypeKey = (manufacturingSpecs?.productType ?? "") as string;
  const portalProductTypeMeta = portalProductTypeKey ? productTypeMeta[portalProductTypeKey] ?? null : null;
  const formatDim = (d?: { length?: string; width?: string; height?: string } | null) =>
    d ? `${d.length || "—"} × ${d.width || "—"} × ${d.height || "—"}` : "—";
  const portalKindLabel = isInternal
    ? invite.recipientType === "internal_factory"
      ? "Internal factory ETD portal"
      : "Internal company ETD portal"
    : isPriceValidity
      ? `${supplierCategoryLabel} · ${priceValidityMonths}-month price-validity inquiry`
      : isPolybag
        ? "Polythene bag inquiry portal"
        : isSupplierRfq
          ? `${supplierCategoryLabel} supplier portal`
          : "Subcontractor response portal";

  const sessionBannerLabel = isInternal
    ? "Internal ETD-only session — pricing is intentionally hidden"
    : isPriceValidity
      ? `Price-validity inquiry — your unit price (USD) will remain valid for ${priceValidityMonths} months; PO issued later when required`
      : isPolybag
        ? "Polythene bag inquiry — quote unit price (USD) + earliest delivery date you can commit to"
        : isSupplierRfq
          ? `Supplier RFQ session — unit price (USD) + delivery date for ${supplierCategoryLabel}`
          : "External commercial quotation session — price + ETD";

  const recipientHeading = invite.recipientName;
  const recipientSubline = isInternal
    ? `${invite.factory?.location ?? invite.company?.clusterName ?? "Internal TEG"} · ${detail.data.rfq.clusterName}`
    : invite.subcontractor?.specialty ?? "External subcontractor";

  return (
    <main
      className="min-h-screen bg-background p-4 md:p-8"
      data-testid={isInternal ? "page-internal-portal" : "page-subcontractor-portal"}
    >
      <div className="mx-auto grid max-w-5xl gap-6">
        <div
          className={`rounded-xl border px-4 py-2 text-xs font-medium uppercase tracking-wide ${
            isInternal
              ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
              : "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
          }`}
          data-testid="banner-session-kind"
        >
          {sessionBannerLabel}
        </div>
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground" data-testid="text-portal-kind">
              {portalKindLabel}
            </p>
            <h1 className="text-xl font-semibold" data-testid="text-portal-reference">
              {detail.data.rfq.reference}
            </h1>
            <p className="text-sm text-muted-foreground">
              {recipientHeading} · {recipientSubline}
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/" data-testid="link-back-internal">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Internal dashboard
            </Link>
          </Button>
        </header>

        {isAccepted && (
          <Card
            className="border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30"
            data-testid="section-portal-accepted"
          >
            <CardContent className="flex items-start gap-3 p-4">
              <Award className="mt-0.5 h-5 w-5 text-emerald-700 dark:text-emerald-300" />
              <div className="grid gap-1">
                <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                  Awarded to you
                </p>
                <p className="text-sm text-emerald-900/80 dark:text-emerald-200/80">
                  This RFQ has been accepted and awarded to you. The negotiation thread is closed.
                  {!isHidden && invite.currentPrice
                    ? ` Final price: ${formatPrice(invite.currentPrice)}.`
                    : ""}
                  {invite.currentEtd ? ` ETD: ${invite.currentEtd}.` : ""}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {isClosed && (
          <Card
            className="border-rose-300 bg-rose-50/60 dark:border-rose-800 dark:bg-rose-950/30"
            data-testid="section-portal-closed"
          >
            <CardContent className="flex items-start gap-3 p-4">
              <Lock className="mt-0.5 h-5 w-5 text-rose-700 dark:text-rose-300" />
              <div className="grid gap-1">
                <p className="text-sm font-semibold text-rose-900 dark:text-rose-200">
                  RFQ closed
                </p>
                <p
                  className="text-sm text-rose-900/80 dark:text-rose-200/80"
                  data-testid="text-portal-closure-reason"
                >
                  {invite.closureReason ??
                    "This RFQ has been closed. The negotiation thread is no longer active."}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card data-testid="portal-notifications">
          <CardHeader className="pb-3">
            <div className="flex items-start gap-3">
              <div className="rounded-xl border bg-secondary p-2 text-secondary-foreground">
                <Bell className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-base">Messages</CardTitle>
                <CardDescription className="text-xs">
                  Email-style notification preview · in-app only · scoped to this invite link.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {portalNotifications.isLoading ? (
              <div className="grid gap-2">
                <div className="h-16 animate-pulse rounded-xl bg-muted" />
              </div>
            ) : !portalNotifications.data || portalNotifications.data.length === 0 ? (
              <div
                className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground"
                data-testid="portal-notifications-empty"
              >
                No messages yet for this invite.
              </div>
            ) : (
              <div className="grid gap-2">
                {portalNotifications.data.map((note) => {
                  const Icon =
                    note.notificationType === "award_approved"
                      ? Award
                      : note.notificationType === "award_closure"
                      ? XCircle
                      : note.notificationType === "quote_received"
                      ? Inbox
                      : Send;
                  const tone =
                    note.notificationType === "award_approved"
                      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200 border-emerald-200 dark:border-emerald-900"
                      : note.notificationType === "award_closure"
                      ? "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200 border-rose-200 dark:border-rose-900"
                      : "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200 border-sky-200 dark:border-sky-900";
                  return (
                    <article
                      key={note.id}
                      className={`relative grid gap-2 rounded-xl border p-3 ${
                        note.isRead ? "bg-card/60" : "bg-card"
                      }`}
                      data-testid={`portal-notification-row-${note.id}`}
                      data-read={note.isRead ? "1" : "0"}
                    >
                      <header className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex items-start gap-3">
                          <div className={`mt-0.5 rounded-md border p-1.5 ${tone}`}>
                            <Icon className="h-3.5 w-3.5" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                                {note.notificationType.replaceAll("_", " ")}
                              </Badge>
                              <span className="text-[11px] text-muted-foreground">
                                To: {note.recipientLabel}
                              </span>
                              {!note.isRead && (
                                <span
                                  className="inline-flex h-1.5 w-1.5 rounded-full bg-primary"
                                  aria-label="Unread"
                                />
                              )}
                            </div>
                            <p
                              className={`mt-1 text-sm ${
                                note.isRead ? "font-medium text-foreground/80" : "font-semibold"
                              }`}
                              data-testid={`portal-notification-subject-${note.id}`}
                            >
                              {note.subject}
                            </p>
                          </div>
                        </div>
                        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                          {formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}
                        </span>
                      </header>
                      <Separator />
                      <pre
                        className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-muted-foreground"
                        data-testid={`portal-notification-body-${note.id}`}
                      >
                        {note.body}
                      </pre>
                      <footer className="flex justify-end">
                        {note.isRead ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                            <MailOpen className="h-3 w-3" /> Read
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => markPortalRead.mutate(note.id)}
                            disabled={markPortalRead.isPending}
                            data-testid={`portal-notification-mark-read-${note.id}`}
                          >
                            <Mail className="mr-2 h-3.5 w-3.5" />
                            Mark read
                          </Button>
                        )}
                      </footer>
                    </article>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {isPriceValidity && !isAccepted && !isClosed && (
          <Card
            className="border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/30"
            data-testid="notice-price-validity"
          >
            <CardContent className="flex items-start gap-3 p-4">
              <Lock className="mt-0.5 h-5 w-5 text-amber-700 dark:text-amber-300" />
              <div>
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  This is a {priceValidityMonths}-month price-validity inquiry, not a single-order RFQ.
                </p>
                <p className="text-sm text-amber-900/80 dark:text-amber-200/80">
                  Submit a unit price (USD) that will remain valid for {priceValidityMonths} months. TEG will issue purchase orders later as quantities are required — you are not being asked to ship a single order yet.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
        {isPolybag && !isAccepted && !isClosed && polybagSpecs && (
          <Card
            className="border-indigo-300 bg-indigo-50/60 dark:border-indigo-800 dark:bg-indigo-950/30"
            data-testid="notice-polybag"
          >
            <CardContent className="grid gap-2 p-4">
              <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
                Polythene bag inquiry specs
              </p>
              <div className="grid gap-2 text-sm text-indigo-900/80 dark:text-indigo-200/80 sm:grid-cols-2">
                <p>
                  <span className="text-xs uppercase tracking-wide">Marketed size (L×W×H)</span>
                  <br />
                  <span className="font-medium" data-testid="text-portal-marketed-size">
                    {polybagSpecs.marketedSize ? formatDim(polybagSpecs.marketedSize) : (polybagSpecs.bagSize ?? "—")}
                  </span>
                </p>
                <p>
                  <span className="text-xs uppercase tracking-wide">Actual bag size (L×W×H)</span>
                  <br />
                  <span className="font-medium" data-testid="text-portal-actual-size">
                    {formatDim(polybagSpecs.actualSize)}
                  </span>
                </p>
              </div>
              <div className="grid gap-2 text-sm text-indigo-900/80 dark:text-indigo-200/80 sm:grid-cols-2">
                <p>
                  <span className="text-xs uppercase tracking-wide">Gauge</span>
                  <br />
                  <span className="font-medium" data-testid="text-portal-gauge">{polybagSpecs.gauge ?? "—"}</span>
                </p>
                <p>
                  <span className="text-xs uppercase tracking-wide">ETD required</span>
                  <br />
                  <span className="font-medium" data-testid="text-portal-etd-required">{polybagSpecs.etdRequired ?? "—"}</span>
                </p>
              </div>
              {polybagSpecs.bagSize && polybagSpecs.marketedSize && (
                <p className="text-[11px] text-indigo-900/70 dark:text-indigo-200/70">
                  Legacy size note: <span className="font-medium" data-testid="text-portal-bag-size">{polybagSpecs.bagSize}</span>
                </p>
              )}
              <p className="text-xs text-indigo-900/70 dark:text-indigo-200/70">
                Submit unit price (USD) + the earliest delivery date you can commit to. TEG will compare quotes and may renegotiate.
              </p>
            </CardContent>
          </Card>
        )}

        {!isAccepted && !isClosed && portalProductLines.length > 0 && (
          <Card
            className="border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30"
            data-testid="notice-manufacturing"
          >
            <CardContent className="grid gap-3 p-4">
              <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                Products in this RFQ ({portalProductLines.length})
              </p>
              <ul className="grid gap-3" data-testid="list-portal-product-lines">
                {portalProductLines.map((line, idx) => {
                  const ptKey = line.productType as string;
                  const ptMeta = productTypeMeta[ptKey] ?? null;
                  const sizeLabel = ptMeta?.sizeLabel ?? "Product size";
                  return (
                    <li
                      key={idx}
                      className="rounded-lg border border-emerald-200/60 bg-card/70 p-3 text-emerald-900/90 dark:border-emerald-900/40 dark:bg-card/40 dark:text-emerald-100/90"
                      data-testid={`row-portal-product-line-${idx}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold">
                          {idx + 1}. {ptMeta?.label ?? ptKey}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {line.quantity} · Loadability: {line.loadabilityPerContainer}/container
                        </p>
                      </div>
                      <div className="mt-2 grid gap-1 text-xs sm:grid-cols-3">
                        <p>
                          <span className="uppercase tracking-wide text-muted-foreground">Material</span><br />
                          <span className="font-medium" data-testid={`text-portal-product-line-material-${idx}`}>{line.materialSpecification}</span>
                        </p>
                        <p>
                          <span className="uppercase tracking-wide text-muted-foreground">{sizeLabel}</span><br />
                          <span className="font-medium" data-testid={`text-portal-product-line-size-${idx}`}>{line.productSize}</span>
                        </p>
                        <p>
                          <span className="uppercase tracking-wide text-muted-foreground">EC level</span><br />
                          <span className="font-medium" data-testid={`text-portal-product-line-ec-${idx}`}>{line.ecLevel}</span>
                        </p>
                      </div>
                      {line.notes ? (
                        <p className="mt-2 text-xs text-muted-foreground" data-testid={`text-portal-product-line-notes-${idx}`}>
                          Notes: {line.notes}
                        </p>
                      ) : null}
                      {Array.isArray(line.productionSplits) && line.productionSplits.length >= 2 ? (
                        <div
                          className="mt-2 rounded-md border border-sky-200 bg-sky-50/60 p-2 text-xs dark:border-sky-900 dark:bg-sky-950/30"
                          data-testid={`row-portal-product-line-splits-${idx}`}
                        >
                          <p className="font-semibold text-sky-900 dark:text-sky-200">
                            Split across {line.productionSplits.length} locations
                          </p>
                          <ul className="mt-1 grid gap-0.5 text-sky-900/80 dark:text-sky-200/80">
                            {line.productionSplits.map((row, sidx) => (
                              <li
                                key={sidx}
                                className="flex flex-wrap gap-x-2"
                                data-testid={`text-portal-product-line-split-${idx}-${sidx}`}
                              >
                                <span className="font-medium">{row.locationName}</span>
                                <span>— {row.allocation}</span>
                                {row.note ? <span className="text-muted-foreground">({row.note})</span> : null}
                              </li>
                            ))}
                          </ul>
                          <p className="mt-1 text-[11px] text-sky-900/70 dark:text-sky-200/70">
                            Quote for the share you are asked to commit to.
                          </p>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}

        {!isAccepted && !isClosed && !anyLineSplit && productionSplits.length >= 2 && (
          <Card
            className="border-sky-300 bg-sky-50/60 dark:border-sky-800 dark:bg-sky-950/30"
            data-testid="notice-production-splits"
          >
            <CardContent className="grid gap-2 p-4">
              <p className="text-sm font-semibold text-sky-900 dark:text-sky-200">
                Legacy RFQ-level production split across {productionSplits.length} locations
              </p>
              <ul className="grid gap-1 text-sm text-sky-900/80 dark:text-sky-200/80">
                {productionSplits.map((row, idx) => (
                  <li key={idx} className="flex flex-wrap gap-x-2" data-testid={`text-portal-split-${idx}`}>
                    <span className="font-medium">{row.locationName}</span>
                    <span>— {row.allocation}</span>
                    {row.note ? <span className="text-muted-foreground">({row.note})</span> : null}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-sky-900/70 dark:text-sky-200/70">
                Note: this order may be produced at more than one location. Quote for the share TEG asks you to commit to.
              </p>
            </CardContent>
          </Card>
        )}

        {isHidden && !isAccepted && !isClosed && (
          <Card className="border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/30" data-testid="notice-price-hidden">
            <CardContent className="flex items-start gap-3 p-4">
              <ShieldOff className="mt-0.5 h-5 w-5 text-amber-700 dark:text-amber-300" />
              <div>
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">Pricing is hidden for this internal request</p>
                <p className="text-sm text-amber-900/80 dark:text-amber-200/80">
                  Confirm only the earliest dispatch date (ETD). Pricing is handled by the TEG team outside this portal and never displayed here.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <CardTitle data-testid="text-portal-rfq-title">
                  {detail.data.rfq.category === "manufacturing_subcontractor" && detail.data.rfq.partnerClient
                    ? detail.data.rfq.partnerClient
                    : detail.data.rfq.packageName}
                </CardTitle>
                <CardDescription>
                  {detail.data.rfq.category === "manufacturing_subcontractor" && detail.data.rfq.poCustomerName
                    ? `PO Customer: ${detail.data.rfq.poCustomerName} · response due ${detail.data.rfq.responseDue}`
                    : `${detail.data.rfq.projectName} · response due ${detail.data.rfq.responseDue}`}
                </CardDescription>
              </div>
              <Badge className={statusClass(invite.status)} data-testid="badge-portal-status">
                {statusLabel(invite.status)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-6">
            <section className="grid gap-4 rounded-xl border bg-card/60 p-4 md:grid-cols-4">
              {detail.data.rfq.category === "manufacturing_subcontractor" ? (
                <>
                  <div data-testid="text-portal-partner-client">
                    <Label>Partner / Client</Label>
                    <p className="mt-1 text-sm">
                      {detail.data.rfq.partnerClient || (
                        <span className="text-muted-foreground">Not recorded</span>
                      )}
                    </p>
                  </div>
                  <div data-testid="text-portal-po-country">
                    <Label>Country</Label>
                    <p className="mt-1 text-sm">
                      {detail.data.rfq.poCountry || (
                        <span className="text-muted-foreground">Not recorded</span>
                      )}
                    </p>
                  </div>
                  <div data-testid="text-portal-po-customer">
                    <Label>Customer stated on PO</Label>
                    <p className="mt-1 text-sm">
                      {detail.data.rfq.poCustomerName || (
                        <span className="text-muted-foreground">Not recorded</span>
                      )}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Reference only — the PO document itself is not shared.
                    </p>
                  </div>
                </>
              ) : (
                <div className="md:col-span-2">
                  <Label>Scope</Label>
                  <p className="mt-1 text-sm text-muted-foreground">{detail.data.rfq.description}</p>
                </div>
              )}
              <div>
                <Label>Quantity</Label>
                <p className="mt-1 text-sm">
                  {detail.data.rfq.quantity}{" "}
                  {(detail.data.rfq.category ?? "manufacturing_subcontractor") === "manufacturing_subcontractor" ? (
                    <span className="text-muted-foreground">· Loadability: {detail.data.rfq.unit}</span>
                  ) : (
                    detail.data.rfq.unit
                  )}
                </p>
              </div>
              <div>
                <Label>Target ETD</Label>
                <p className="mt-1 text-sm">{detail.data.rfq.targetEtd}</p>
              </div>
            </section>

            <section className="grid gap-6 lg:grid-cols-[1fr_420px]">
              <div className="grid gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Negotiation history</h2>
                  <p className="text-sm text-muted-foreground">
                    {isHidden
                      ? "You can revise the ETD as many times as needed. Pricing is intentionally not part of this thread."
                      : "You can revise price and ETD as many times as required before either party accepts or declines."}
                  </p>
                </div>
                <div className="grid gap-3">
                  {invite.negotiations.map((entry) => (
                    <article
                      key={entry.id}
                      className="rounded-xl border bg-background p-4"
                      data-testid={`portal-timeline-${entry.id}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">
                          {entry.actor === "buyer"
                            ? "TEG team"
                            : entry.actor === "factory"
                              ? invite.factory?.name ?? invite.company?.name ?? "Internal recipient"
                              : invite.subcontractor?.name ?? invite.recipientName}
                        </Badge>
                        <span className="text-xs uppercase tracking-wide text-muted-foreground">{entry.action}</span>
                      </div>
                      <p className="mt-2 text-sm">{entry.note}</p>
                      {(entry.etd || (!isHidden && entry.price)) && (
                        <p className="mt-2 text-sm text-muted-foreground">
                          {!isHidden && entry.price ? `Price: ${formatPrice(entry.price)}` : ""}
                          {entry.etd ? ` ETD: ${entry.etd}` : ""}
                        </p>
                      )}
                    </article>
                  ))}
                  {!invite.negotiations.length && (
                    <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                      {isHidden
                        ? "Submit your earliest available ETD to begin the internal record."
                        : "Submit your first quotation to start the negotiation record."}
                    </div>
                  )}
                </div>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Your response</CardTitle>
                  <CardDescription>
                    {isHidden
                      ? `Current ETD: ${invite.currentEtd ?? "not submitted"}`
                      : `Current price: ${formatPrice(invite.currentPrice)} · ETD: ${invite.currentEtd ?? "not submitted"}`}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {isHidden ? (
                    <Form {...internalForm}>
                      <form
                        className="grid gap-4"
                        onSubmit={internalForm.handleSubmit((values) =>
                          mutation.mutate({ action: primaryAction, etd: values.etd, note: values.note }),
                        )}
                      >
                        <FormField
                          control={internalForm.control}
                          name="etd"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Earliest ETD you can commit to</FormLabel>
                              <FormControl>
                                <Input
                                  type="date"
                                  disabled={disabled}
                                  data-testid="input-portal-etd"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={internalForm.control}
                          name="note"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Message</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="Capacity, constraints, or reason for ETD revision..."
                                  disabled={disabled}
                                  data-testid="textarea-portal-note"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button
                          type="submit"
                          disabled={disabled || mutation.isPending}
                          data-testid="button-submit-etd"
                        >
                          <Send className="mr-2 h-4 w-4" />
                          Submit {primaryAction === "quote" ? "ETD" : "revised ETD"}
                        </Button>
                        <Separator />
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            disabled={disabled || mutation.isPending}
                            onClick={() =>
                              mutation.mutate({
                                action: "accept",
                                note: "Internal recipient accepted the negotiated ETD.",
                              })
                            }
                            data-testid="button-portal-accept"
                          >
                            <CheckCircle2 className="mr-2 h-4 w-4" />
                            Accept
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            disabled={disabled || mutation.isPending}
                            onClick={() =>
                              mutation.mutate({
                                action: "decline",
                                note: "Internal recipient declined this ETD-only request.",
                              })
                            }
                            data-testid="button-portal-decline"
                          >
                            <XCircle className="mr-2 h-4 w-4" />
                            Decline
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Accept or decline closes this internal thread. The TEG team can still escalate the same inquiry to an external subcontractor as a commercial RFQ.
                        </p>
                      </form>
                    </Form>
                  ) : (
                    <Form {...externalForm}>
                      <form
                        className="grid gap-4"
                        onSubmit={externalForm.handleSubmit((values) =>
                          mutation.mutate({ action: primaryAction, ...values }),
                        )}
                      >
                        <FormField
                          control={externalForm.control}
                          name="price"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                Price (USD)
                                {bothRequired ? (
                                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                                    — required
                                  </span>
                                ) : null}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  min="1"
                                  required={bothRequired}
                                  aria-required={bothRequired}
                                  disabled={disabled}
                                  data-testid="input-portal-price"
                                  {...field}
                                />
                              </FormControl>
                              {bothRequired ? (
                                <p className="text-xs text-muted-foreground">
                                  Price (USD) required
                                </p>
                              ) : null}
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={externalForm.control}
                          name="etd"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                ETD / delivery date
                                {bothRequired ? (
                                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                                    — required
                                  </span>
                                ) : null}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="date"
                                  required={bothRequired}
                                  aria-required={bothRequired}
                                  disabled={disabled}
                                  data-testid="input-portal-etd"
                                  {...field}
                                />
                              </FormControl>
                              {bothRequired ? (
                                <p className="text-xs text-muted-foreground">
                                  ETD / delivery date required
                                </p>
                              ) : null}
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={externalForm.control}
                          name="note"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Message</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="Add assumptions, exclusions, or reason for revised price / ETD..."
                                  disabled={disabled}
                                  data-testid="textarea-portal-note"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button
                          type="submit"
                          disabled={disabled || mutation.isPending}
                          data-testid="button-submit-quote"
                        >
                          <Send className="mr-2 h-4 w-4" />
                          {isPriceValidity
                            ? `Submit ${priceValidityMonths}-month price`
                            : `Submit ${primaryAction === "quote" ? "quote" : "counter"}`}
                        </Button>
                        {mutation.isError && mutation.error instanceof Error ? (
                          <p
                            className="text-sm text-destructive"
                            data-testid="text-portal-submit-error"
                          >
                            {mutation.error.message}
                          </p>
                        ) : null}
                        <Separator />
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            disabled={disabled || mutation.isPending}
                            onClick={() =>
                              mutation.mutate({
                                action: "accept",
                                note: "Subcontractor accepted the latest negotiated terms.",
                              })
                            }
                            data-testid="button-portal-accept"
                          >
                            <CheckCircle2 className="mr-2 h-4 w-4" />
                            Accept
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            disabled={disabled || mutation.isPending}
                            onClick={() =>
                              mutation.mutate({
                                action: "decline",
                                note: "Subcontractor declined this RFQ.",
                              })
                            }
                            data-testid="button-portal-decline"
                          >
                            <XCircle className="mr-2 h-4 w-4" />
                            Decline
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {isPriceValidity
                            ? `Acceptance records your ${priceValidityMonths}-month unit-price validity — not a single order. TEG will raise purchase orders later as required.`
                            : isPolybag
                              ? "Acceptance records your quote on this polybag inquiry. TEG may renegotiate or pick a lower price from another supplier."
                              : "Acceptance or decline closes this subcontractor response thread. Other subcontractors remain separate."}
                        </p>
                      </form>
                    </Form>
                  )}
                </CardContent>
              </Card>
            </section>
          </CardContent>
        </Card>

        {/* Portal-safe revision history. Renders only revision number, date,
            and a generic safe summary. Hidden when only the Rev 0 baseline
            exists. The endpoint NEVER returns reasons, internal summaries,
            or per-field changes — vendors / factories never see those. */}
        <PortalAmendmentHistory token={token} />
      </div>
    </main>
  );
}
