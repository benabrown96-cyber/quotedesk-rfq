import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Download, FileText, Lock, ShieldCheck, Trash2, Upload } from "lucide-react";
import type { RfqDocumentMeta, RfqDocumentType } from "@shared/schema";
import { RFQ_DOCUMENT_TYPES } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { API_BASE, apiRequest, queryClient } from "@/lib/queryClient";
import { getCurrentRoleHeaders } from "@/lib/role-context";

const MAX_BYTES = 15 * 1024 * 1024;

const TYPE_LABEL: Record<RfqDocumentType, string> = {
  purchase_order: "Purchase Order",
  pricing_quotation: "Pricing Quotation",
};

const TYPE_DESCRIPTION: Record<RfqDocumentType, string> = {
  purchase_order:
    "Upload the actual customer Purchase Order file (PDF, image, or Office document) that drives this RFQ.",
  pricing_quotation:
    "Upload the actual Pricing Quotation file used to brief Senior Management. Never shared with factories or subcontractors.",
};

const TYPE_UPLOAD_LABEL: Record<RfqDocumentType, string> = {
  purchase_order: "Upload Purchase Order document",
  pricing_quotation: "Upload Pricing Quotation document",
};

const TYPE_REPLACE_LABEL: Record<RfqDocumentType, string> = {
  purchase_order: "Upload new Purchase Order version",
  pricing_quotation: "Upload new Pricing Quotation version",
};

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function readFileAsBase64(file: File): Promise<string> {
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

type Props = {
  rfqId: number;
  rfqReference: string;
  isAdmin: boolean;
};

export function RfqDocumentsPanel({ rfqId, rfqReference, isAdmin }: Props) {
  const { toast } = useToast();

  const documentsQuery = useQuery<RfqDocumentMeta[]>({
    queryKey: ["/api/rfqs", rfqId, "documents"],
    enabled: Boolean(rfqId) && isAdmin,
  });

  const upload = useMutation({
    mutationFn: async (input: { documentType: RfqDocumentType; file: File }) => {
      if (input.file.size > MAX_BYTES) {
        throw new Error(`File too large (${formatBytes(input.file.size)}). Max ${formatBytes(MAX_BYTES)}.`);
      }
      const contentBase64 = await readFileAsBase64(input.file);
      const response = await apiRequest("POST", `/api/rfqs/${rfqId}/documents`, {
        documentType: input.documentType,
        filename: input.file.name,
        mimeType: input.file.type || "application/octet-stream",
        size: input.file.size,
        contentBase64,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfqs", rfqId, "documents"] });
      toast({ title: "Document uploaded", description: "The reference document is attached to this RFQ." });
    },
    onError: (error: Error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const remove = useMutation({
    mutationFn: async (documentId: number) => {
      await apiRequest("DELETE", `/api/rfqs/${rfqId}/documents/${documentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rfqs", rfqId, "documents"] });
      toast({ title: "Document removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Remove failed", description: error.message, variant: "destructive" });
    },
  });

  // Non-admins must not see the panel at all (data leakage prevention).
  if (!isAdmin) return null;

  const docs = documentsQuery.data ?? [];

  return (
    <Card
      className="border-dashed border-amber-300/70 bg-amber-50/40 dark:border-amber-800/60 dark:bg-amber-950/20"
      data-testid="card-rfq-documents"
    >
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-amber-700 dark:text-amber-400" />
              Admin reference documents
            </CardTitle>
            <CardDescription data-testid="text-documents-helper">
              {rfqReference} · Admin-only reference documents. These files are not visible to internal factories
              or subcontractors. Upload the actual Purchase Order and Pricing Quotation files — not placeholders.
            </CardDescription>
          </div>
          <Badge variant="outline" className="gap-1 border-amber-400 text-amber-800 dark:text-amber-200">
            <Lock className="h-3.5 w-3.5" />
            Group admin only
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-2">
          {RFQ_DOCUMENT_TYPES.map((docType) => (
            <DocumentSlot
              key={docType}
              docType={docType}
              docs={docs.filter((doc) => doc.documentType === docType)}
              onUpload={(file) => upload.mutate({ documentType: docType, file })}
              onDelete={(documentId) => remove.mutate(documentId)}
              uploading={upload.isPending}
              rfqId={rfqId}
            />
          ))}
        </div>
        {documentsQuery.isLoading && (
          <p className="text-sm text-muted-foreground" data-testid="text-documents-loading">
            Loading documents…
          </p>
        )}
        {!documentsQuery.isLoading && docs.length === 0 && (
          <p
            className="rounded-lg border border-dashed border-amber-300/70 bg-background/40 p-3 text-xs text-muted-foreground"
            data-testid="text-documents-empty"
          >
            No reference documents attached yet. Upload the actual customer Purchase Order document and the actual
            internal Pricing Quotation document so the admin team can review the real files alongside this RFQ.
            These files stay admin-only — internal factories and subcontractors will not see them.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

type SlotProps = {
  docType: RfqDocumentType;
  docs: RfqDocumentMeta[];
  onUpload: (file: File) => void;
  onDelete: (documentId: number) => void;
  uploading: boolean;
  rfqId: number;
};

function DocumentSlot({ docType, docs, onUpload, onDelete, uploading, rfqId }: SlotProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const handleDownload = async (doc: RfqDocumentMeta) => {
    setDownloadingId(doc.id);
    try {
      const headers = getCurrentRoleHeaders();
      const response = await fetch(
        `${API_BASE}/api/rfqs/${rfqId}/documents/${doc.id}?download=1`,
        { headers },
      );
      if (!response.ok) {
        throw new Error(`${response.status}: ${(await response.text()) || response.statusText}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = doc.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div
      className="grid gap-3 rounded-xl border bg-background/60 p-4"
      data-testid={`section-document-${docType}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{TYPE_LABEL[docType]}</h3>
          <p className="text-xs text-muted-foreground">{TYPE_DESCRIPTION[docType]}</p>
        </div>
        <Badge variant="secondary" className="text-[11px]">
          {docs.length} attached
        </Badge>
      </div>

      <div>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.csv,.txt,application/pdf,image/*"
          className="hidden"
          data-testid={`input-upload-${docType}`}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onUpload(file);
            if (inputRef.current) inputRef.current.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          data-testid={`button-upload-${docType}`}
        >
          <Upload className="mr-2 h-4 w-4" />
          {docs.length > 0 ? TYPE_REPLACE_LABEL[docType] : TYPE_UPLOAD_LABEL[docType]}
        </Button>
        <p
          className="mt-2 text-[11px] text-muted-foreground"
          data-testid={`text-upload-helper-${docType}`}
        >
          Admin-only reference document. Not visible to internal factories or subcontractors. PDF, image, or Office
          file up to {formatBytes(MAX_BYTES)}.
        </p>
      </div>

      {docs.length > 0 && (
        <ul className="grid gap-2" data-testid={`list-documents-${docType}`}>
          {docs.map((doc) => (
            <li
              key={doc.id}
              className="grid gap-1 rounded-lg border bg-card/80 p-3 text-xs"
              data-testid={`row-document-${doc.id}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p
                      className="truncate font-medium text-foreground"
                      title={doc.filename}
                      data-testid={`text-document-name-${doc.id}`}
                    >
                      {doc.filename}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatBytes(doc.size)} · {doc.mimeType || "file"} · uploaded{" "}
                      {(() => {
                        try {
                          return format(new Date(doc.uploadedAt), "d MMM yyyy, HH:mm");
                        } catch {
                          return doc.uploadedAt;
                        }
                      })()}{" "}
                      by {doc.uploadedBy}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    disabled={downloadingId === doc.id}
                    onClick={() => handleDownload(doc)}
                    data-testid={`link-download-document-${doc.id}`}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-destructive hover:text-destructive"
                    onClick={() => onDelete(doc.id)}
                    data-testid={`button-delete-document-${doc.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
