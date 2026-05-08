import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Award,
  CheckCircle2,
  ClipboardCheck,
  RotateCcw,
  Send,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";

export type Recommendation = {
  id: number;
  rfqId: number;
  inviteId: number;
  status: "pending" | "approved" | "rejected" | "returned";
  recommendedByRole: string;
  recommendedBy?: string | null;
  rationale: string;
  proposedClosureReason?: string | null;
  decisionNote?: string | null;
  decidedByRole?: string | null;
  createdAt: string;
  decidedAt?: string | null;
};

export type RecommendationInvite = {
  id: number;
  recipientName: string;
  status: string;
  currentPrice?: number | null;
  currentEtd?: string | null;
  priceVisibility: "visible" | "hidden";
};

function statusBadgeClass(status: Recommendation["status"]) {
  if (status === "pending") {
    return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
  }
  if (status === "approved") {
    return "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200";
  }
  if (status === "rejected") {
    return "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200";
  }
  return "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200";
}

function statusLabel(status: Recommendation["status"]) {
  if (status === "pending") return "Pending Senior Management approval";
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Returned for revision";
}

function formatPrice(value?: number | null) {
  if (!value) return "No price yet";
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function RecommendationStatusBadge({
  status,
  testIdSuffix,
}: {
  status: Recommendation["status"];
  testIdSuffix: string | number;
}) {
  return (
    <Badge
      className={statusBadgeClass(status)}
      data-testid={`badge-recommendation-status-${testIdSuffix}`}
    >
      {statusLabel(status)}
    </Badge>
  );
}

export function CommercialRecommendationForm({
  rfqId,
  invite,
  hasOpenRecommendation,
}: {
  rfqId: number;
  invite: RecommendationInvite;
  hasOpenRecommendation: boolean;
}) {
  const [rationale, setRationale] = useState("");
  const [closureReason, setClosureReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(
        "POST",
        `/api/rfqs/${rfqId}/recommendations`,
        {
          inviteId: invite.id,
          rationale: rationale.trim(),
          proposedClosureReason: closureReason.trim() || undefined,
        },
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfqs", rfqId, "recommendations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfqs", rfqId] });
      setRationale("");
      setClosureReason("");
      setError(null);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Could not submit recommendation");
    },
  });

  const disabled = submit.isPending || hasOpenRecommendation;
  const tooShort = rationale.trim().length < 5;

  return (
    <div
      className="grid gap-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-900 dark:bg-indigo-950/20"
      data-testid={`form-recommendation-${invite.id}`}
    >
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-indigo-700 dark:text-indigo-300" />
        <p className="font-semibold text-indigo-900 dark:text-indigo-200">
          Recommend for Senior Management approval
        </p>
      </div>
      <p className="text-xs text-indigo-900/80 dark:text-indigo-200/80">
        You cannot accept, decline, or award directly. Submit a recommendation with rationale; Senior Management reviews and decides.
      </p>
      <div className="grid gap-1">
        <Label
          htmlFor={`textarea-recommendation-rationale-${invite.id}`}
          className="text-xs uppercase tracking-wide text-muted-foreground"
        >
          Why this recipient should win (rationale)
        </Label>
        <Textarea
          id={`textarea-recommendation-rationale-${invite.id}`}
          data-testid={`textarea-recommendation-rationale-${invite.id}`}
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
          placeholder="Best price + earliest ETD + preferred rating, after final counter."
          className="min-h-[80px]"
        />
      </div>
      <div className="grid gap-1">
        <Label
          htmlFor={`textarea-recommendation-closure-${invite.id}`}
          className="text-xs uppercase tracking-wide text-muted-foreground"
        >
          Proposed closure reason for non-winning invitees (optional)
        </Label>
        <Textarea
          id={`textarea-recommendation-closure-${invite.id}`}
          data-testid={`textarea-recommendation-closure-${invite.id}`}
          value={closureReason}
          onChange={(event) => setClosureReason(event.target.value)}
          placeholder="Defaults to: Closed automatically because RFQ was awarded to another recipient."
          className="min-h-[60px]"
        />
      </div>
      {error && (
        <p
          className="text-xs text-rose-700 dark:text-rose-300"
          data-testid={`text-recommendation-error-${invite.id}`}
        >
          {error}
        </p>
      )}
      {hasOpenRecommendation && (
        <p
          className="text-xs text-amber-800 dark:text-amber-200"
          data-testid={`text-recommendation-blocked-${invite.id}`}
        >
          A recommendation is already pending on this RFQ. Wait for admin to decide before submitting another.
        </p>
      )}
      <Button
        type="button"
        disabled={disabled || tooShort}
        onClick={() => submit.mutate()}
        data-testid={`button-submit-recommendation-${invite.id}`}
      >
        <Send className="mr-2 h-4 w-4" />
        Recommend for TEG admin approval
      </Button>
    </div>
  );
}

export function AdminRecommendationReviewPanel({
  rfqId,
  invitesById,
}: {
  rfqId: number;
  invitesById: Map<number, RecommendationInvite>;
}) {
  const recommendations = useQuery<Recommendation[]>({
    queryKey: ["/api/rfqs", rfqId, "recommendations"],
  });

  const items = recommendations.data ?? [];
  const pending = items.find((rec) => rec.status === "pending") ?? null;
  const history = items.filter((rec) => rec.status !== "pending");

  return (
    <Card data-testid="card-admin-recommendation-review">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Award recommendations</CardTitle>
            <CardDescription>
              Commercial staff submit award recommendations here for Senior Management to approve, reject, or return.
            </CardDescription>
          </div>
          {pending ? (
            <RecommendationStatusBadge status={pending.status} testIdSuffix={`pending-${pending.id}`} />
          ) : (
            <Badge variant="outline" data-testid="badge-recommendations-empty">
              No pending recommendation
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {pending && (
          <PendingRecommendationCard
            recommendation={pending}
            rfqId={rfqId}
            invite={invitesById.get(pending.inviteId)}
          />
        )}
        {history.length > 0 && (
          <div className="grid gap-3" data-testid="region-recommendation-history">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              History
            </Label>
            {history.map((rec) => (
              <HistoryRecommendationCard
                key={rec.id}
                recommendation={rec}
                invite={invitesById.get(rec.inviteId)}
              />
            ))}
          </div>
        )}
        {!pending && history.length === 0 && (
          <div
            className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground"
            data-testid="text-recommendations-empty"
          >
            No recommendations submitted on this RFQ yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PendingRecommendationCard({
  recommendation,
  rfqId,
  invite,
}: {
  recommendation: Recommendation;
  rfqId: number;
  invite?: RecommendationInvite;
}) {
  const [decisionNote, setDecisionNote] = useState("");
  const [closureReasonOverride, setClosureReasonOverride] = useState("");

  const decide = useMutation({
    mutationFn: async (action: "approve" | "reject" | "return") => {
      const body: { action: typeof action; decisionNote?: string; closureReason?: string } = {
        action,
        decisionNote: decisionNote.trim() || undefined,
      };
      if (action === "approve" && closureReasonOverride.trim()) {
        body.closureReason = closureReasonOverride.trim();
      }
      const response = await apiRequest(
        "POST",
        `/api/recommendations/${recommendation.id}/decision`,
        body,
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfqs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfqs", rfqId] });
      queryClient.invalidateQueries({ queryKey: ["/api/rfqs", rfqId, "recommendations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
      setDecisionNote("");
      setClosureReasonOverride("");
    },
  });

  const priceVisible = invite?.priceVisibility === "visible";

  return (
    <article
      className="grid gap-3 rounded-xl border border-amber-300 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/20"
      data-testid={`card-recommendation-pending-${recommendation.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">
            Recipient: {invite?.recipientName ?? `Invite #${recommendation.inviteId}`}
          </p>
          <p className="text-xs text-muted-foreground">
            Submitted {formatDistanceToNow(new Date(recommendation.createdAt), { addSuffix: true })}
            {recommendation.recommendedBy ? ` by ${recommendation.recommendedBy}` : ""} ({recommendation.recommendedByRole})
          </p>
        </div>
        <RecommendationStatusBadge status={recommendation.status} testIdSuffix={recommendation.id} />
      </div>

      {invite && (
        <div className="grid gap-2 rounded-lg border bg-background p-3 text-sm md:grid-cols-3">
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Price</Label>
            <p className="tabular-nums" data-testid={`text-recommendation-price-${recommendation.id}`}>
              {priceVisible ? formatPrice(invite.currentPrice) : "Hidden (ETD-only)"}
            </p>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">ETD</Label>
            <p data-testid={`text-recommendation-etd-${recommendation.id}`}>
              {invite.currentEtd ?? "Awaiting"}
            </p>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Status</Label>
            <p>{invite.status.replaceAll("_", " ")}</p>
          </div>
        </div>
      )}

      <div className="grid gap-1">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Rationale</Label>
        <p
          className="rounded-lg bg-background p-3 text-sm"
          data-testid={`text-recommendation-rationale-${recommendation.id}`}
        >
          {recommendation.rationale}
        </p>
      </div>

      {recommendation.proposedClosureReason && (
        <div className="grid gap-1">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Proposed closure reason for non-winning invitees
          </Label>
          <p
            className="rounded-lg bg-background p-3 text-sm"
            data-testid={`text-recommendation-closure-${recommendation.id}`}
          >
            {recommendation.proposedClosureReason}
          </p>
        </div>
      )}

      <div className="grid gap-1">
        <Label
          htmlFor={`textarea-decision-note-${recommendation.id}`}
          className="text-xs uppercase tracking-wide text-muted-foreground"
        >
          Admin decision note (visible in history)
        </Label>
        <Textarea
          id={`textarea-decision-note-${recommendation.id}`}
          data-testid={`textarea-decision-note-${recommendation.id}`}
          value={decisionNote}
          onChange={(event) => setDecisionNote(event.target.value)}
          placeholder="Why approving / rejecting / returning. Required when returning or rejecting."
          className="min-h-[60px]"
        />
      </div>

      <div className="grid gap-1">
        <Label
          htmlFor={`textarea-closure-override-${recommendation.id}`}
          className="text-xs uppercase tracking-wide text-muted-foreground"
        >
          Override closure reason on approval (optional)
        </Label>
        <Textarea
          id={`textarea-closure-override-${recommendation.id}`}
          data-testid={`textarea-closure-override-${recommendation.id}`}
          value={closureReasonOverride}
          onChange={(event) => setClosureReasonOverride(event.target.value)}
          placeholder="Leave blank to use the proposed closure reason or the system default."
          className="min-h-[50px]"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={decide.isPending}
          onClick={() => decide.mutate("approve")}
          data-testid={`button-recommendation-approve-${recommendation.id}`}
        >
          <Award className="mr-2 h-4 w-4" />
          Approve &amp; award
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={decide.isPending || decisionNote.trim().length < 1}
          onClick={() => decide.mutate("return")}
          data-testid={`button-recommendation-return-${recommendation.id}`}
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Return for revision
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={decide.isPending || decisionNote.trim().length < 1}
          onClick={() => decide.mutate("reject")}
          data-testid={`button-recommendation-reject-${recommendation.id}`}
        >
          <XCircle className="mr-2 h-4 w-4" />
          Reject
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Approve will award the RFQ, mark the recipient accepted, and close every other invite with the closure reason.
      </p>
    </article>
  );
}

function HistoryRecommendationCard({
  recommendation,
  invite,
}: {
  recommendation: Recommendation;
  invite?: RecommendationInvite;
}) {
  const Icon =
    recommendation.status === "approved"
      ? CheckCircle2
      : recommendation.status === "rejected"
        ? XCircle
        : RotateCcw;
  return (
    <article
      className="grid gap-2 rounded-xl border bg-background p-3 text-sm"
      data-testid={`card-recommendation-history-${recommendation.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <p className="font-medium">
            {invite?.recipientName ?? `Invite #${recommendation.inviteId}`}
          </p>
        </div>
        <RecommendationStatusBadge status={recommendation.status} testIdSuffix={recommendation.id} />
      </div>
      <p className="text-xs text-muted-foreground">
        Submitted {formatDistanceToNow(new Date(recommendation.createdAt), { addSuffix: true })} by{" "}
        {recommendation.recommendedBy ?? recommendation.recommendedByRole}
        {recommendation.decidedAt && recommendation.decidedByRole && (
          <>
            {" "}
            · Decided {formatDistanceToNow(new Date(recommendation.decidedAt), { addSuffix: true })} by{" "}
            {recommendation.decidedByRole}
          </>
        )}
      </p>
      <p>
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Rationale: </span>
        {recommendation.rationale}
      </p>
      {recommendation.decisionNote && (
        <p data-testid={`text-recommendation-decision-${recommendation.id}`}>
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Admin decision note:{" "}
          </span>
          {recommendation.decisionNote}
        </p>
      )}
    </article>
  );
}
