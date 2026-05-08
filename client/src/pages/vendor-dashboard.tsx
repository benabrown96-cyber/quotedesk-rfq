import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  CheckCircle2,
  Circle,
  ClipboardList,
  ExternalLink,
  Inbox,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/role-context";
import { RFQ_CATEGORY_META, type RfqCategory } from "@shared/schema";

// Vendor / subcontractor restricted dashboard.
// Shows ONLY the RFQs the signed-in vendor user has been assigned to via
// `user.subcontractorId`. Server enforces the same filter on /api/rfqs and
// /api/rfqs/:id; this UI is the matching restricted surface. We deliberately
// do NOT load /api/users, /api/subcontractors, /api/notifications,
// /api/rfqs/:id/documents, /api/rfqs/:id/amendments, /api/rfqs/:id/recommendations,
// /api/audit-events, or /api/settings here — those are blocked by the
// allow-list middleware for subcontractor_user.

type VendorRfq = {
  id: number;
  reference: string;
  category: RfqCategory;
  projectName: string;
  packageName: string;
  description: string;
  quantity: string;
  unit: string;
  targetEtd: string;
  responseDue: string;
  status: string;
  awardedInviteId?: number | null;
  createdAt: string;
};

type VendorInvite = {
  id: number;
  rfqId: number;
  status: string;
  token: string;
  currentPrice: number | null;
  currentEtd: string | null;
  closureReason: string | null;
  tokenExpiresAt: string | null;
  tokenRevokedAt: string | null;
  recipientType: string;
  subcontractorId: number | null;
};

type VendorRfqDetail = {
  rfq: VendorRfq;
  invites: VendorInvite[];
};

const STATUS_LABELS: Record<string, { label: string; tone: "default" | "secondary" | "outline" }> = {
  draft: { label: "Draft", tone: "outline" },
  open: { label: "Open", tone: "secondary" },
  sent: { label: "Awaiting your response", tone: "default" },
  responded: { label: "Response submitted", tone: "secondary" },
  under_negotiation: { label: "Under negotiation", tone: "default" },
  awarded: { label: "Awarded", tone: "secondary" },
  accepted: { label: "Accepted", tone: "secondary" },
  declined: { label: "Declined", tone: "outline" },
  closed: { label: "Closed", tone: "outline" },
};

function statusBadge(status: string) {
  const meta = STATUS_LABELS[status] ?? { label: status, tone: "outline" as const };
  return (
    <Badge
      variant={meta.tone === "secondary" ? "secondary" : meta.tone === "outline" ? "outline" : "default"}
      data-testid={`badge-rfq-status-${status}`}
    >
      {meta.label}
    </Badge>
  );
}

function categoryLabel(category: RfqCategory): string {
  return RFQ_CATEGORY_META[category]?.shortLabel ?? category;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function VendorRfqCard({ rfq, user }: { rfq: VendorRfq; user: { name: string } }) {
  const detail = useQuery<VendorRfqDetail>({
    queryKey: ["/api/rfqs", rfq.id],
  });

  const myInvite = detail.data?.invites?.[0] ?? null;
  const portalHref = myInvite?.token ? `#/portal/${myInvite.token}` : null;
  const tokenRevoked = Boolean(myInvite?.tokenRevokedAt);
  const responsePending = myInvite?.status === "sent";
  const responseSubmitted =
    myInvite?.status === "responded" || myInvite?.status === "under_negotiation";
  const awarded = myInvite?.status === "awarded" || myInvite?.status === "accepted";
  const declined = myInvite?.status === "declined" || myInvite?.status === "closed";

  return (
    <Card data-testid={`card-vendor-rfq-${rfq.id}`} className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {categoryLabel(rfq.category)} · {rfq.reference}
            </p>
            <CardTitle className="mt-1 truncate text-base font-semibold" data-testid={`text-rfq-project-${rfq.id}`}>
              {rfq.projectName}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground" data-testid={`text-rfq-package-${rfq.id}`}>
              {rfq.packageName}
            </p>
          </div>
          <div className="shrink-0">{statusBadge(rfq.status)}</div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="line-clamp-3 text-muted-foreground" data-testid={`text-rfq-desc-${rfq.id}`}>
          {rfq.description}
        </p>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Quantity</dt>
            <dd className="font-medium" data-testid={`text-rfq-qty-${rfq.id}`}>
              {rfq.quantity} {rfq.unit}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Target ETD</dt>
            <dd className="font-medium">{formatDate(rfq.targetEtd)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Response due</dt>
            <dd className="font-medium">{formatDate(rfq.responseDue)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Your response</dt>
            <dd className="font-medium" data-testid={`text-rfq-my-response-${rfq.id}`}>
              {detail.isLoading
                ? "Loading…"
                : detail.isError
                  ? "—"
                  : myInvite
                    ? myInvite.currentPrice != null || myInvite.currentEtd
                      ? `${myInvite.currentPrice != null ? `USD ${myInvite.currentPrice.toLocaleString()}` : "no price"} · ETD ${myInvite.currentEtd ? formatDate(myInvite.currentEtd) : "—"}`
                      : "Not yet submitted"
                    : "—"}
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {responsePending ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
              <Circle className="h-3.5 w-3.5" />
              Awaiting your price + ETD
            </span>
          ) : responseSubmitted ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Submitted — TEG team is reviewing
            </span>
          ) : awarded ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {myInvite?.status === "awarded" ? "Awarded — please confirm acceptance via portal" : "Accepted"}
            </span>
          ) : declined ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Circle className="h-3.5 w-3.5" />
              Closed
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {portalHref && !tokenRevoked ? (
              <Button asChild size="sm" data-testid={`button-open-portal-${rfq.id}`}>
                <a href={portalHref}>
                  Open response portal
                  <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                </a>
              </Button>
            ) : tokenRevoked ? (
              <span className="text-xs text-muted-foreground">
                Portal link revoked — contact TEG.
              </span>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function VendorDashboard() {
  const { user } = useAuth();
  const rfqsQuery = useQuery<VendorRfq[]>({ queryKey: ["/api/rfqs"] });

  const items = useMemo(() => {
    const all = rfqsQuery.data ?? [];
    return [...all].sort((a, b) => {
      // Pending first, then by createdAt desc.
      const order = (status: string) => {
        if (status === "sent") return 0;
        if (status === "under_negotiation") return 1;
        if (status === "responded") return 2;
        if (status === "awarded" || status === "accepted") return 3;
        return 4;
      };
      const diff = order(a.status) - order(b.status);
      if (diff !== 0) return diff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [rfqsQuery.data]);

  if (!user) return null;

  return (
    <main
      className="flex-1 bg-background"
      data-testid="page-vendor-dashboard"
    >
      <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Vendor portal</p>
          <h1
            className="text-xl font-semibold sm:text-xl"
            data-testid="heading-vendor-dashboard"
          >
            Vendor dashboard — your assigned RFQs
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground" data-testid="text-vendor-dashboard-helper">
            Signed in as <span className="font-medium text-foreground">{user.name}</span>. This view is
            restricted to RFQs that TEG has assigned to your account. To submit or revise a price + ETD
            response, open the portal link on the relevant RFQ — the per-invite portal remains the
            external response experience for every RFQ.
          </p>
        </header>

        <Card data-testid="card-vendor-restrictions" className="border-dashed">
          <CardContent className="flex flex-wrap items-start gap-3 py-4 text-sm">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="space-y-1">
              <p className="font-medium">What you can see here</p>
              <p className="text-muted-foreground">
                Only the RFQs assigned to {user.name}. Other vendors' names, prices, ETDs,
                internal documents, comparison tables, and award decisions are not visible.
              </p>
            </div>
          </CardContent>
        </Card>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
              Assigned RFQs
              <span
                className="text-xs text-muted-foreground"
                data-testid="text-vendor-rfq-count"
              >
                ({rfqsQuery.isLoading ? "…" : items.length})
              </span>
            </h2>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
              Updated live
            </span>
          </div>

          {rfqsQuery.isLoading ? (
            <div className="grid gap-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-32 animate-pulse rounded-lg border bg-muted/30"
                  data-testid={`skeleton-vendor-rfq-${i}`}
                />
              ))}
            </div>
          ) : rfqsQuery.isError ? (
            <Card data-testid="card-vendor-error">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Couldn't load your assigned RFQs. Please refresh, or contact your TEG contact.
              </CardContent>
            </Card>
          ) : items.length === 0 ? (
            <Card data-testid="card-vendor-empty">
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
                <Inbox className="h-6 w-6 text-muted-foreground/70" />
                <p className="font-medium text-foreground">No RFQs assigned yet</p>
                <p>When TEG sends you an RFQ, it will appear here. You'll also receive a portal link.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3" data-testid="list-vendor-rfqs">
              {items.map((rfq) => (
                <VendorRfqCard key={rfq.id} rfq={rfq} user={{ name: user.name }} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
