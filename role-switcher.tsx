import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, FileText, ShieldAlert, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DocumentRequirementStatus, RfqDocumentType } from "@shared/schema";

const TYPE_LABEL: Record<RfqDocumentType, string> = {
  purchase_order: "Purchase Order",
  pricing_quotation: "Pricing Quotation",
};

// Document Requirement Checklist
// ------------------------------
// Shown to internal roles (senior_management, commercial_manager, commercial_staff,
// platform_admin) on Product Manufacturing RFQs. Renders only present/missing
// booleans — never filenames, sizes, or any other metadata. The server endpoint
// (/api/rfqs/:id/document-requirements) returns the same boolean-only structure;
// vendors / factories never reach it.
export function DocumentRequirementChecklist({
  rfqId,
  enabled = true,
}: {
  rfqId: number;
  enabled?: boolean;
}) {
  const query = useQuery<DocumentRequirementStatus>({
    queryKey: ["/api/rfqs", rfqId, "document-requirements"],
    enabled: Boolean(rfqId) && enabled,
  });

  const status = query.data;
  if (!status || !status.required) return null; // Non-manufacturing RFQs — nothing to show.

  const tone = status.satisfied
    ? "border-emerald-300 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20"
    : "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/30";

  return (
    <Card className={`border-dashed ${tone}`} data-testid="card-document-checklist">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              Required documents
            </CardTitle>
            <CardDescription data-testid="text-document-checklist-helper">
              Product Manufacturing RFQs must have both the Purchase Order and the Pricing
              Quotation attached before invites can be sent or an award approved. Files stay
              admin-only — vendors and factories never see them.
            </CardDescription>
          </div>
          <Badge
            className={
              status.satisfied
                ? "bg-emerald-600 text-white"
                : "bg-amber-500 text-white"
            }
            data-testid="badge-document-checklist-status"
          >
            {status.satisfied ? "Ready to send" : "Not ready — docs missing"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2 sm:grid-cols-2" data-testid="list-document-checklist">
          {status.byType.map((row) => (
            <li
              key={row.documentType}
              className="flex items-center gap-2 rounded-lg border bg-background/60 p-3"
              data-testid={`row-document-checklist-${row.documentType}`}
            >
              {row.present ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <XCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              )}
              <FileText className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{TYPE_LABEL[row.documentType]}</p>
                <p className="text-[11px] text-muted-foreground">
                  {row.present ? "Attached" : "Not attached yet"}
                </p>
              </div>
            </li>
          ))}
        </ul>
        {!status.satisfied && (
          <p
            className="mt-3 rounded-lg border border-amber-300 bg-amber-100/60 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            data-testid="text-document-checklist-blocked"
          >
            Send and award are blocked until the missing document
            {status.missingLabels.length === 1 ? "" : "s"} ({status.missingLabels.join(", ")})
            {status.missingLabels.length === 1 ? " is" : " are"} attached. Senior Management can
            attach files in the Reference Documents panel below.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export type DocumentRequirementChecklistProps = {
  rfqId: number;
  enabled?: boolean;
};
