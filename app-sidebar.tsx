import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Timer, TimerReset, AlarmClockOff, CalendarClock, CalendarCheck2, CalendarX2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  computeExpiryState,
  computeDealCloseState,
  type ExpiryState,
  type DealCloseState,
} from "@shared/lib";
import {
  DEFAULT_RFQ_RESPONSE_DAYS,
  DEFAULT_RESPONSE_DAY_MODE,
  DEFAULT_DEAL_CLOSE_DAYS,
  DEFAULT_DEAL_CLOSE_DAY_MODE,
  type SystemSettings,
} from "@shared/schema";

function formatSettingsLabel(days: number, mode: "business" | "calendar"): string {
  const unit = mode === "calendar" ? "calendar" : "business";
  const base = `${days} ${unit} day${days === 1 ? "" : "s"}`;
  if (days === 1 && mode === "calendar") return `${base} (24 hours)`;
  return base;
}

function formatRemaining(ms: number) {
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes - days * 60 * 24) / 60);
  const minutes = totalMinutes - days * 60 * 24 - hours * 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function RfqExpiryCountdown({
  expiresAt,
  responseDue,
  status,
  className,
  testIdSuffix = "rfq",
}: {
  expiresAt?: string | null;
  responseDue?: string | null;
  status?: string;
  className?: string;
  testIdSuffix?: string;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const settingsQuery = useQuery<SystemSettings>({ queryKey: ["/api/settings"] });
  const settingsLabel = settingsQuery.data
    ? formatSettingsLabel(settingsQuery.data.responseDefaultDays, settingsQuery.data.responseDayMode)
    : formatSettingsLabel(DEFAULT_RFQ_RESPONSE_DAYS, DEFAULT_RESPONSE_DAY_MODE);

  const state: ExpiryState = computeExpiryState({
    expiresAt,
    responseDue,
    status,
    now,
  });

  if (state.kind === "none") return null;

  const baseClass = `inline-flex items-center gap-1.5 ${className ?? ""}`;
  if (state.kind === "expired") {
    return (
      <Badge
        className="bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200"
        aria-label="Response window expired"
        data-testid={`expiry-${testIdSuffix}-expired`}
      >
        <AlarmClockOff className="mr-1 h-3.5 w-3.5" />
        Expired
      </Badge>
    );
  }
  if (state.kind === "negotiating") {
    return (
      <Badge
        className="bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        aria-label="Negotiation ongoing, expiry paused"
        data-testid={`expiry-${testIdSuffix}-negotiating`}
      >
        <TimerReset className="mr-1 h-3.5 w-3.5" />
        Negotiation ongoing \u2014 expiry paused
      </Badge>
    );
  }
  // Active
  return (
    <span className={baseClass} data-testid={`expiry-${testIdSuffix}-active`}>
      <Badge variant="outline" aria-label="Initial response window remaining">
        <Timer className="mr-1 h-3.5 w-3.5" />
        Initial response: {formatRemaining(state.remainingMs)} remaining
      </Badge>
      <span className="text-xs text-muted-foreground" data-testid={`expiry-${testIdSuffix}-window-label`}>
        Default window: {settingsLabel}
      </span>
    </span>
  );
}

// Deal close target countdown. Shown alongside the initial response countdown so users
// can see both deadlines distinctly. Closed/awarded RFQs render a calm "Deal closed"
// state; overdue RFQs show a red "Deal close overdue" warning. Active RFQs show the
// remaining time in days/hours until the close-by deadline.
export function DealCloseCountdown({
  dealCloseDue,
  createdAt,
  status,
  className,
  testIdSuffix = "rfq",
}: {
  dealCloseDue?: string | null;
  createdAt?: string | null;
  status?: string;
  className?: string;
  testIdSuffix?: string;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const settingsQuery = useQuery<SystemSettings>({ queryKey: ["/api/settings"] });
  const fallbackDays = settingsQuery.data?.dealCloseDefaultDays ?? DEFAULT_DEAL_CLOSE_DAYS;
  const fallbackDayMode = settingsQuery.data?.dealCloseDayMode ?? DEFAULT_DEAL_CLOSE_DAY_MODE;

  const state: DealCloseState = computeDealCloseState({
    dealCloseDue,
    createdAt,
    status,
    fallbackDays,
    fallbackDayMode,
    now,
  });

  if (state.kind === "none") return null;
  const baseClass = `inline-flex items-center gap-1.5 ${className ?? ""}`;

  if (state.kind === "closed") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
        aria-label="Deal closed"
        data-testid={`deal-close-${testIdSuffix}-closed`}
      >
        <CalendarCheck2 className="mr-1 h-3.5 w-3.5" />
        Deal closed
      </Badge>
    );
  }

  if (state.kind === "overdue") {
    return (
      <Badge
        className="bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200"
        aria-label="Deal close overdue"
        data-testid={`deal-close-${testIdSuffix}-overdue`}
      >
        <CalendarX2 className="mr-1 h-3.5 w-3.5" />
        Deal close overdue
      </Badge>
    );
  }

  // Active
  return (
    <span className={baseClass} data-testid={`deal-close-${testIdSuffix}-active`}>
      <Badge
        variant="outline"
        className="border-primary/30 text-primary"
        aria-label="Deal close target"
      >
        <CalendarClock className="mr-1 h-3.5 w-3.5" />
        Deal close: {formatRemaining(state.remainingMs)} left
      </Badge>
    </span>
  );
}
