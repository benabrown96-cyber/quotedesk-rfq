import { useQuery } from "@tanstack/react-query";
import { ScrollText, History } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/role-context";
import { RolePerms } from "@shared/roles";

type AuditEvent = {
  id: number;
  eventType: string;
  rfqId: number | null;
  inviteId: number | null;
  recommendationId: number | null;
  documentId: number | null;
  actorUserId: number | null;
  actorRole: string;
  actorLabel: string;
  action: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

const EVENT_LABELS: Record<string, string> = {
  rfq_created: "RFQ created",
  invite_sent: "Invite sent",
  quote_submitted: "Quote received",
  etd_submitted: "ETD response",
  buyer_counter: "TEG counter",
  recommendation_submitted: "Recommendation submitted",
  recommendation_decided: "Recommendation decided",
  award_approved: "Award approved",
  rfq_closed: "RFQ closed",
  rfq_expired: "RFQ expired",
  document_uploaded: "Document uploaded",
  document_deleted: "Document deleted",
  user_grant_changed: "User permission changed",
  user_active_changed: "User active toggled",
  token_revoked: "Token revoked",
  token_extended: "Token extended",
};

function eventColor(type: string) {
  if (type.startsWith("token_")) return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
  if (type.startsWith("user_")) return "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200";
  if (type === "award_approved") return "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200";
  if (type === "rfq_expired") return "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200";
  return "bg-secondary text-secondary-foreground";
}

export function AuditTrailPanel({
  rfqId,
  variant = "card",
  limit,
}: {
  rfqId?: number;
  variant?: "card" | "inline";
  limit?: number;
}) {
  const { role } = useAuth();
  // RFQ-scoped audit visible to senior mgmt / commercial mgr / commercial staff; global only to senior mgmt + platform admin.
  const allowedScoped = RolePerms.canViewRfqAuditTrail(role);
  const allowedGlobal = RolePerms.canViewAuditTrail(role);
  if ((rfqId && !allowedScoped) || (!rfqId && !allowedGlobal)) return null;

  const query = useQuery<AuditEvent[]>({
    queryKey: rfqId ? ["/api/audit-events", { rfqId, limit }] : ["/api/audit-events", { limit }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (rfqId) params.set("rfqId", String(rfqId));
      if (limit) params.set("limit", String(limit));
      const url = `/api/audit-events${params.toString() ? `?${params.toString()}` : ""}`;
      const { apiRequest } = await import("@/lib/queryClient");
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  const events = query.data ?? [];
  const heading = rfqId ? "RFQ audit history" : "Recent audit events";
  const description = rfqId
    ? "Every change on this RFQ \u2014 who, what, and when."
    : "Group-wide audit log. Visible to Senior Management and Platform Admin.";

  const Wrapper = variant === "card" ? Card : "div";
  const inner = (
    <>
      {variant === "card" && (
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
              {rfqId ? <History className="h-4 w-4" /> : <ScrollText className="h-4 w-4" />}
            </div>
            <div>
              <CardTitle className="text-base">{heading}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
          </div>
        </CardHeader>
      )}
      <CardContent className={variant === "inline" ? "p-0" : undefined}>
        {query.isLoading && (
          <p className="text-sm text-muted-foreground" data-testid="audit-loading">Loading audit events\u2026</p>
        )}
        {!query.isLoading && events.length === 0 && (
          <p className="text-sm text-muted-foreground" data-testid="audit-empty">No audit events yet.</p>
        )}
        {!!events.length && (
          <ol className="grid gap-2" data-testid="audit-list">
            {events.map((event) => (
              <li
                key={event.id}
                className="rounded-lg border bg-card/60 p-3"
                data-testid={`audit-event-${event.id}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={eventColor(event.eventType)}>
                    {EVENT_LABELS[event.eventType] ?? event.eventType}
                  </Badge>
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    {event.action}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(event.createdAt), { addSuffix: true })}
                  </span>
                </div>
                <p className="mt-1.5 text-sm">{event.summary}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {event.actorLabel}
                  {event.rfqId ? ` \u00b7 RFQ #${event.rfqId}` : ""}
                  {event.inviteId ? ` \u00b7 invite #${event.inviteId}` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </>
  );

  if (variant === "card") {
    return (
      <Card data-testid={rfqId ? `audit-rfq-${rfqId}` : "audit-global"}>{inner}</Card>
    );
  }
  return <div data-testid={rfqId ? `audit-rfq-${rfqId}` : "audit-global"}>{inner}</div>;
}
