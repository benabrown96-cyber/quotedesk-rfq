import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, ArrowDown, BadgeCheck, Clock, Lock, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatUSD } from "@shared/lib";

// Internal-only quote comparison table.
// Visible to senior_management, commercial_manager, and commercial_staff (within scope).
// Platform Admin and Factory Users see no commercial decision data — the parent
// component decides whether to render this. External vendors / subcontractors hit
// the portal endpoints and never see this component.
// We use a lightweight structural type so the table works with the dashboard's
// hydrated invite shape (Invite from home.tsx) without coupling to the full
// InviteWithDetails import — fields not used here are optional.
export type ComparisonInvite = {
  id: number;
  recipientType: string;
  recipientName: string;
  country?: string | null;
  priceVisibility: "visible" | "hidden" | string;
  status: string;
  currentPrice?: number | null;
  currentEtd?: string | null;
  lastNote?: string | null;
  updatedAt?: string | null;
  negotiations?: Array<{ actor: string; createdAt: string }>;
  // Optional vendor-type details when known (subcontractor row hydrated in home.tsx).
  subcontractor?: { vendorType?: string | null } | null;
};

type Props = {
  invites: ComparisonInvite[];
  awardedInviteId: number | null;
  // Used to drive the lowest-price marker — only invites with a visible price count.
  // Internal ETD-only rows (priceVisibility === "hidden") are shown but never marked.
};

function vendorTypeLabel(invite: ComparisonInvite): string {
  if (invite.recipientType === "external_subcontractor") {
    const sub = invite.subcontractor;
    if (sub?.vendorType === "manufacturing_subcontractor") return "Manufacturing subcontractor";
    if (sub?.vendorType === "supplier") return "Supplier";
    return "External vendor";
  }
  if (invite.recipientType === "internal_factory") return "Internal factory (ETD-only)";
  if (invite.recipientType === "internal_company") return "Intercompany producer";
  return invite.recipientType;
}

function statusTone(status: string): string {
  if (status === "accepted" || status === "awarded") return "bg-emerald-600 text-white";
  if (status === "declined" || status === "closed") return "bg-rose-100 text-rose-900 dark:bg-rose-950/40 dark:text-rose-200";
  if (status === "responded" || status === "quoted" || status === "countered") return "bg-blue-100 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200";
  return "bg-muted text-foreground";
}

function shortDate(value?: string | null): string {
  if (!value) return "—";
  // Accept either YYYY-MM-DD or full ISO; show as local short-date.
  try {
    const d = new Date(value);
    if (!Number.isFinite(d.valueOf())) return value;
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return value;
  }
}

function lastResponseAge(invite: ComparisonInvite): string {
  // Use the most recent vendor/factory negotiation timestamp; fall back to invite.updatedAt.
  const negs = invite.negotiations ?? [];
  const lastVendorMessage = [...negs].reverse().find((n) => n.actor !== "buyer");
  const ts = lastVendorMessage?.createdAt ?? invite.updatedAt ?? null;
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    if (!Number.isFinite(d.valueOf())) return "—";
    return `${formatDistanceToNow(d)} ago`;
  } catch {
    return "—";
  }
}

export function QuoteComparisonTable({ invites, awardedInviteId }: Props) {
  if (!invites.length) return null;

  // Lowest-price marker — only price-visible invites with a numeric currentPrice.
  const priceVisibleInvites = invites.filter(
    (inv) => inv.priceVisibility === "visible" && typeof inv.currentPrice === "number" && inv.currentPrice! > 0,
  );
  const lowestPrice = priceVisibleInvites.reduce<number | null>((min, inv) => {
    const p = inv.currentPrice ?? null;
    if (p == null) return min;
    if (min == null || p < min) return p;
    return min;
  }, null);

  // Earliest ETD marker — pick the lexicographically smallest ISO date among invites
  // with a currentEtd. ISO YYYY-MM-DD compares correctly as strings.
  const etdValues = invites.map((i) => i.currentEtd).filter((v): v is string => Boolean(v));
  const earliestEtd = etdValues.length ? etdValues.reduce((a, b) => (a < b ? a : b)) : null;

  return (
    <Card data-testid="card-quote-comparison">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-4 w-4 text-amber-500" />
              Internal quote comparison
            </CardTitle>
            <CardDescription data-testid="text-quote-comparison-helper">
              Side-by-side view of every invite's latest price, ETD, and response. Internal-only —
              never visible to vendors, factories, or external subcontractors.
            </CardDescription>
          </div>
          <Badge variant="outline" className="gap-1 border-amber-300 text-amber-800 dark:text-amber-200">
            <Lock className="h-3.5 w-3.5" />
            Internal commercial view
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0 sm:px-6">
        <div className="min-w-[920px] px-4 sm:min-w-0 sm:px-0">
          <Table data-testid="table-quote-comparison">
            <TableHeader>
              <TableRow>
                <TableHead>Recipient</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Price (USD)</TableHead>
                <TableHead>ETD</TableHead>
                <TableHead>Last response</TableHead>
                <TableHead className="min-w-[160px]">Last note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.map((invite) => {
                const isAwarded =
                  invite.id === awardedInviteId || invite.status === "accepted" || invite.status === "awarded";
                const isPriceVisible = invite.priceVisibility === "visible";
                const isLowest =
                  isPriceVisible &&
                  lowestPrice != null &&
                  typeof invite.currentPrice === "number" &&
                  invite.currentPrice === lowestPrice;
                const isEarliest = invite.currentEtd != null && earliestEtd != null && invite.currentEtd === earliestEtd;
                return (
                  <TableRow
                    key={invite.id}
                    data-testid={`row-quote-comparison-${invite.id}`}
                    className={isAwarded ? "bg-emerald-50/50 dark:bg-emerald-950/20" : ""}
                  >
                    <TableCell className="font-medium">
                      <div className="flex flex-wrap items-center gap-2">
                        <span data-testid={`text-quote-comparison-name-${invite.id}`}>
                          {invite.recipientName}
                        </span>
                        {isAwarded && (
                          <Badge className="bg-emerald-600 text-white" data-testid={`badge-comparison-awarded-${invite.id}`}>
                            <BadgeCheck className="mr-1 h-3 w-3" /> Awarded
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {invite.country ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {vendorTypeLabel(invite)}
                    </TableCell>
                    <TableCell>
                      <Badge className={statusTone(invite.status)}>{invite.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {!isPriceVisible ? (
                        <span
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                          data-testid={`text-comparison-no-price-${invite.id}`}
                          title="Internal ETD-only — no price on this row"
                        >
                          <AlertTriangle className="h-3 w-3 text-amber-500" />
                          ETD-only · no price
                        </span>
                      ) : invite.currentPrice == null ? (
                        <span className="text-xs text-muted-foreground">Awaiting</span>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5">
                          <span data-testid={`text-comparison-price-${invite.id}`}>
                            {formatUSD(invite.currentPrice)}
                          </span>
                          {isLowest && (
                            <Badge
                              className="gap-0.5 bg-amber-500 text-white hover:bg-amber-500"
                              data-testid={`badge-comparison-lowest-${invite.id}`}
                            >
                              <ArrowDown className="h-3 w-3" /> Lowest
                            </Badge>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {invite.currentEtd ? (
                        <div className="flex items-center gap-1.5">
                          <span data-testid={`text-comparison-etd-${invite.id}`}>
                            {shortDate(invite.currentEtd)}
                          </span>
                          {isEarliest && (
                            <Badge
                              variant="outline"
                              className="border-emerald-400 text-emerald-700 dark:text-emerald-300"
                              data-testid={`badge-comparison-earliest-${invite.id}`}
                            >
                              <Clock className="mr-0.5 h-3 w-3" /> Earliest
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Awaiting</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <span data-testid={`text-comparison-age-${invite.id}`}>
                        {lastResponseAge(invite)}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">
                      <span
                        className="line-clamp-2 max-w-[260px]"
                        data-testid={`text-comparison-note-${invite.id}`}
                        title={invite.lastNote ?? undefined}
                      >
                        {invite.lastNote ?? "—"}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="mt-3 px-4 text-[11px] text-muted-foreground sm:px-0">
            Lowest price and earliest ETD are highlighted automatically. Internal ETD-only rows are
            shown without price by design.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
