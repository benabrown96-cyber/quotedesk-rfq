import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { GitBranch, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RfqAmendment, RfqAmendmentSafe } from "@shared/schema";

// AmendmentHistoryPanel — full internal version history for senior management,
// commercial managers, and commercial staff (within scope). Hidden from external
// portal users; the portal renders <PortalAmendmentHistory> instead.
export function AmendmentHistoryPanel({ rfqId }: { rfqId: number }) {
  const query = useQuery<RfqAmendment[]>({
    queryKey: ["/api/rfqs", rfqId, "amendments"],
    enabled: Boolean(rfqId),
  });

  const data = query.data ?? [];

  return (
    <Card data-testid="card-amendment-history">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-muted-foreground" />
              Amendment / version history
            </CardTitle>
            <CardDescription>
              Every revision of this RFQ — who changed it, when, what changed, and whether
              recipients were notified. Internal-only.
            </CardDescription>
          </div>
          <Badge variant="outline" className="gap-1">
            <GitBranch className="h-3.5 w-3.5" />
            {data.length} {data.length === 1 ? "revision" : "revisions"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {query.isLoading && (
          <p className="text-sm text-muted-foreground" data-testid="text-amendments-loading">
            Loading history…
          </p>
        )}
        {!query.isLoading && data.length === 0 && (
          <p
            className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground"
            data-testid="text-amendments-empty"
          >
            No amendments recorded yet for this RFQ.
          </p>
        )}
        {data.length > 0 && (
          <ol className="grid gap-3" data-testid="list-amendments">
            {data
              .slice()
              .sort((a, b) => b.revisionNumber - a.revisionNumber)
              .map((row) => (
                <li
                  key={row.id}
                  className="rounded-xl border bg-card p-4"
                  data-testid={`row-amendment-${row.id}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          className="bg-primary/10 text-primary"
                          data-testid={`badge-amendment-rev-${row.id}`}
                        >
                          Rev {row.revisionNumber}
                        </Badge>
                        <span className="text-sm font-semibold">{row.changedBy}</span>
                        <span className="text-xs text-muted-foreground">{row.changedByRole}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {(() => {
                          try {
                            return format(new Date(row.createdAt), "d MMM yyyy, HH:mm");
                          } catch {
                            return row.createdAt;
                          }
                        })()}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className="text-[11px]"
                      data-testid={`badge-amendment-notified-${row.id}`}
                    >
                      Notifications:{" "}
                      {row.notifiedRecipients > 0
                        ? `${row.notifiedRecipients} recipient${row.notifiedRecipients === 1 ? "" : "s"}`
                        : "none"}
                    </Badge>
                  </div>
                  {row.reason && (
                    <p
                      className="mt-3 rounded-lg border bg-muted/40 p-2 text-xs"
                      data-testid={`text-amendment-reason-${row.id}`}
                    >
                      <span className="font-semibold">Reason:</span> {row.reason}
                    </p>
                  )}
                  <p
                    className="mt-2 text-sm text-foreground"
                    data-testid={`text-amendment-internal-summary-${row.id}`}
                  >
                    {row.internalSummary}
                  </p>
                  {row.changedFields.length > 0 && (
                    <details className="mt-3 text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        View {row.changedFields.length} field change
                        {row.changedFields.length === 1 ? "" : "s"}
                      </summary>
                      <ul
                        className="mt-2 grid gap-2"
                        data-testid={`list-amendment-changed-${row.id}`}
                      >
                        {row.changedFields.map((field) => (
                          <li
                            key={field.field}
                            className="grid gap-1 rounded-lg border bg-background p-2"
                            data-testid={`row-amendment-field-${row.id}-${field.field}`}
                          >
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {field.field}
                            </p>
                            <div className="grid gap-1 sm:grid-cols-2">
                              <div>
                                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                  Before
                                </p>
                                <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px]">
                                  {formatValue(field.before)}
                                </pre>
                              </div>
                              <div>
                                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                  After
                                </p>
                                <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px]">
                                  {formatValue(field.after)}
                                </pre>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v || "—";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// Portal-safe amendment list. Uses a separate query key + endpoint so the portal
// page never receives internal fields. Keep this rendering deliberately minimal —
// only revision number, date, and the safe summary string.
export function PortalAmendmentHistory({ token }: { token: string }) {
  const query = useQuery<RfqAmendmentSafe[]>({
    queryKey: ["/api/portal", token, "amendments"],
    enabled: Boolean(token),
  });
  const data = query.data ?? [];
  if (query.isLoading) return null;
  // Suppress when there are no real amendments. Rev 0 is the original-creation baseline
  // — nothing has changed for the recipient until at least one Rev 1+ row exists.
  const hasRealRevisions = data.some((row) => row.revisionNumber >= 1);
  if (!hasRealRevisions) {
    return null;
  }
  // Filter Rev 0 out of the portal display — it's not informative for vendors.
  const visible = data.filter((row) => row.revisionNumber >= 1);
  if (visible.length === 0) return null;
  return (
    <section
      className="rounded-2xl border bg-card p-5"
      data-testid="section-portal-amendments"
    >
      <header className="flex items-center gap-2">
        <History className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">Revision history</h2>
      </header>
      <p className="mt-1 text-sm text-muted-foreground">
        Each entry shows when this RFQ was updated. Open the latest details above to see the
        current scope.
      </p>
      <ol className="mt-3 grid gap-2" data-testid="list-portal-amendments">
        {visible
          .slice()
          .sort((a, b) => b.revisionNumber - a.revisionNumber)
          .map((row) => (
            <li
              key={row.id}
              className="rounded-lg border bg-background p-3 text-sm"
              data-testid={`row-portal-amendment-${row.id}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant="outline" className="text-[11px]">
                  Rev {row.revisionNumber}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {(() => {
                    try {
                      return format(new Date(row.createdAt), "d MMM yyyy, HH:mm");
                    } catch {
                      return row.createdAt;
                    }
                  })()}
                </span>
              </div>
              <p className="mt-1">{row.safeSummary}</p>
            </li>
          ))}
      </ol>
    </section>
  );
}
