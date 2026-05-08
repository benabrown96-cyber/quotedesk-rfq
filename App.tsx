import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Award, Bell, CheckCheck, Inbox, Mail, MailOpen, Pencil, Send, Sparkles, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { apiRequest, queryClient } from "@/lib/queryClient";

// Notification type matches the server's hydrated Notification shape (Omit readByRoles raw + isRead boolean).
export type NotificationItem = {
  id: number;
  rfqId: number;
  inviteId: number | null;
  recommendationId: number | null;
  notificationType:
    | "rfq_sent"
    | "rfq_updated"
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

const TYPE_META: Record<
  NotificationItem["notificationType"],
  { label: string; icon: typeof Bell; toneClass: string }
> = {
  rfq_sent: {
    label: "RFQ sent",
    icon: Send,
    toneClass:
      "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200 border-sky-200 dark:border-sky-900",
  },
  quote_received: {
    label: "Quote received",
    icon: Inbox,
    toneClass:
      "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-200 border-amber-200 dark:border-amber-900",
  },
  recommendation_pending: {
    label: "Recommendation pending",
    icon: Sparkles,
    toneClass:
      "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200 border-indigo-200 dark:border-indigo-900",
  },
  award_approved: {
    label: "Award approved",
    icon: Award,
    toneClass:
      "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200 border-emerald-200 dark:border-emerald-900",
  },
  award_closure: {
    label: "RFQ closed",
    icon: XCircle,
    toneClass:
      "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200 border-rose-200 dark:border-rose-900",
  },
  rfq_updated: {
    label: "RFQ updated",
    icon: Pencil,
    toneClass:
      "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200 border-violet-200 dark:border-violet-900",
  },
};

type NotificationCenterProps = {
  // Optional rfqId — when provided, scopes the list to that RFQ (used for RFQ-detail history).
  rfqId?: number;
  // Heading + description override for inline (RFQ-detail) usage.
  variant?: "dashboard" | "inline";
};

export function NotificationCenter({ rfqId, variant = "dashboard" }: NotificationCenterProps) {
  const queryKey = rfqId ? ["/api/notifications", { rfqId }] : ["/api/notifications"];
  const url = rfqId ? `/api/notifications?rfqId=${rfqId}` : "/api/notifications";

  const notifications = useQuery<NotificationItem[]>({
    queryKey,
    queryFn: async () => {
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  const markRead = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/notifications/${id}/read`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const markAll = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/notifications/read-all", {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const items = notifications.data ?? [];
  const unreadCount = useMemo(() => items.filter((n) => !n.isRead).length, [items]);

  const inline = variant === "inline";

  return (
    <Card data-testid="notification-center">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-xl border bg-secondary p-2 text-secondary-foreground">
              <Bell className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base">
                {inline ? "RFQ notification history" : "Notification center"}
              </CardTitle>
              <CardDescription className="text-xs">
                Email-style notification preview · in-app only · no real emails are sent.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={unreadCount > 0 ? "default" : "secondary"}
              data-testid="notification-unread-count"
            >
              {unreadCount} unread
            </Badge>
            <Button
              variant="outline"
              size="sm"
              disabled={!unreadCount || markAll.isPending}
              onClick={() => markAll.mutate()}
              data-testid="button-mark-all-read"
            >
              <CheckCheck className="mr-2 h-3.5 w-3.5" />
              Mark all read
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {notifications.isLoading ? (
          <div className="grid gap-2">
            <div className="h-16 animate-pulse rounded-xl bg-muted" />
            <div className="h-16 animate-pulse rounded-xl bg-muted" />
          </div>
        ) : items.length === 0 ? (
          <div
            className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground"
            data-testid="notification-empty"
          >
            No notifications yet. Send an invite, receive a quote, or run an award to see
            email-style messages appear here.
          </div>
        ) : (
          <ScrollArea className={inline ? "max-h-[460px]" : "max-h-[520px]"}>
            <div className="grid gap-2 pr-2">
              {items.map((note) => {
                const meta = TYPE_META[note.notificationType];
                const Icon = meta.icon;
                return (
                  <article
                    key={note.id}
                    className={`relative grid gap-2 rounded-xl border p-3 transition-colors ${
                      note.isRead
                        ? "bg-card/60"
                        : "bg-card shadow-[0_1px_0_0_var(--border)]"
                    }`}
                    data-testid={`notification-row-${note.id}`}
                    data-read={note.isRead ? "1" : "0"}
                  >
                    <header className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 rounded-md border p-1.5 ${meta.toneClass}`}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant="outline"
                              className="text-[10px] uppercase tracking-wide"
                              data-testid={`notification-type-${note.id}`}
                            >
                              {meta.label}
                            </Badge>
                            <span
                              className="text-[11px] text-muted-foreground"
                              data-testid={`notification-recipient-${note.id}`}
                            >
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
                            data-testid={`notification-subject-${note.id}`}
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
                      data-testid={`notification-body-${note.id}`}
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
                          onClick={() => markRead.mutate(note.id)}
                          disabled={markRead.isPending}
                          data-testid={`button-mark-read-${note.id}`}
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
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
