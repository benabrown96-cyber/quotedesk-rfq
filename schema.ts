// Shared client/server utilities. Currency, business-day helpers, expiry computation.
//
// Timezone assumption: TEG operates from Sri Lanka (Asia/Colombo). The business-day
// helper is timezone-naive and operates on calendar dates only \u2014 production should
// reuse the same helper but optionally honor a configurable holiday calendar.

import {
  ACTIVE_NEGOTIATION_STATUSES,
  DEFAULT_CURRENCY,
  DEFAULT_RFQ_RESPONSE_DAYS,
  DEFAULT_RESPONSE_DAY_MODE,
  DEFAULT_DEAL_CLOSE_DAYS,
  DEFAULT_DEAL_CLOSE_DAY_MODE,
  DEFAULT_TOKEN_EXPIRY_BUSINESS_DAYS,
  type ResponseDayMode,
} from "./schema";

export const ASSUMED_TIMEZONE = "Asia/Colombo";

// Format an integer USD price. We treat stored prices as whole-dollar integers
// today; a future iteration can introduce a minor-units / decimal column.
export function formatUSD(value?: number | null, options?: { compact?: boolean }) {
  if (value == null || Number.isNaN(value)) return "No price yet";
  if (options?.compact) {
    return `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  return `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 })} ${DEFAULT_CURRENCY}`;
}

// Add N business days to a date (skip Saturdays and Sundays).
export function addBusinessDays(start: Date, businessDays: number): Date {
  const result = new Date(start);
  let added = 0;
  while (added < businessDays) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return result;
}

// Add N calendar days (no weekend skipping).
export function addCalendarDays(start: Date, days: number): Date {
  const result = new Date(start);
  result.setDate(result.getDate() + days);
  return result;
}

// Compute a default response-due date from a creation date, honouring the configured day-mode.
// Defaults: 1 calendar day (~24 hours) — see DEFAULT_RFQ_RESPONSE_DAYS / DEFAULT_RESPONSE_DAY_MODE.
export function defaultResponseDue(
  createdAt: Date | string = new Date(),
  days = DEFAULT_RFQ_RESPONSE_DAYS,
  dayMode: ResponseDayMode = DEFAULT_RESPONSE_DAY_MODE,
): string {
  const start = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  const due = dayMode === "calendar" ? addCalendarDays(start, days) : addBusinessDays(start, days);
  return due.toISOString().slice(0, 10);
}

// Friendly label for a configured response window. Used by the create-RFQ form and countdown.
export function formatResponseWindow(days: number, dayMode: ResponseDayMode): string {
  return `${days} ${dayMode === "calendar" ? "calendar" : "business"} day${days === 1 ? "" : "s"}`;
}

// Compute the deal-close target from a creation date. Returns ISO datetime so the
// UI can render an end-of-day deadline; defaults to end-of-business (17:00 UTC) on
// the computed close date. Honours calendar vs business day-mode the same way the
// response window does.
export function defaultDealCloseDue(
  createdAt: Date | string = new Date(),
  days = DEFAULT_DEAL_CLOSE_DAYS,
  dayMode: ResponseDayMode = DEFAULT_DEAL_CLOSE_DAY_MODE,
): string {
  const start = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  const due = dayMode === "calendar" ? addCalendarDays(start, days) : addBusinessDays(start, days);
  return `${due.toISOString().slice(0, 10)}T17:00:00.000Z`;
}

// Effective deal-close state. Closed/awarded/accepted RFQs are intentionally not
// flagged overdue — the deal IS closed in those terminal states. Active negotiation
// does NOT pause the close-by deadline (unlike the response window) because the
// 7-day rule is the overall close target, regardless of mid-flight messages.
export type DealCloseState =
  | { kind: "none" }
  | { kind: "closed"; status: string }
  | { kind: "active"; remainingMs: number; dueAt: string }
  | { kind: "overdue"; overdueMs: number; dueAt: string };

export function computeDealCloseState(args: {
  dealCloseDue?: string | null;
  createdAt?: string | null;
  status?: string;
  // Optional fallback when dealCloseDue is null on legacy rows.
  fallbackDays?: number;
  fallbackDayMode?: ResponseDayMode;
  now?: Date;
}): DealCloseState {
  const status = args.status ?? "";
  // Terminal states never count as overdue.
  if (status === "awarded" || status === "accepted" || status === "closed") {
    return { kind: "closed", status };
  }
  let dueRaw = args.dealCloseDue;
  if (!dueRaw && args.createdAt) {
    dueRaw = defaultDealCloseDue(
      args.createdAt,
      args.fallbackDays ?? DEFAULT_DEAL_CLOSE_DAYS,
      args.fallbackDayMode ?? DEFAULT_DEAL_CLOSE_DAY_MODE,
    );
  }
  if (!dueRaw) return { kind: "none" };
  const due = new Date(dueRaw);
  if (Number.isNaN(due.getTime())) return { kind: "none" };
  const now = args.now ?? new Date();
  if (now < due) {
    return { kind: "active", remainingMs: due.getTime() - now.getTime(), dueAt: due.toISOString() };
  }
  return { kind: "overdue", overdueMs: now.getTime() - due.getTime(), dueAt: due.toISOString() };
}

// Default token expiry. Aligned with the RFQ response window default (1 calendar day / ~24h).
// Kept as calendar days so portals don't skip weekends for a 24-hour ETD window.
export function defaultTokenExpiry(from: Date | string = new Date(), days = DEFAULT_TOKEN_EXPIRY_BUSINESS_DAYS): string {
  const start = typeof from === "string" ? new Date(from) : from;
  return addCalendarDays(start, days).toISOString();
}

// Business-day count between two dates (inclusive end). Negative if end < start.
export function businessDaysBetween(start: Date, end: Date): number {
  const a = new Date(start);
  a.setHours(0, 0, 0, 0);
  const b = new Date(end);
  b.setHours(0, 0, 0, 0);
  if (a.getTime() === b.getTime()) return 0;
  const sign = b > a ? 1 : -1;
  let days = 0;
  let cursor = new Date(a);
  while (cursor.getTime() !== b.getTime()) {
    cursor.setDate(cursor.getDate() + sign);
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) days += sign;
  }
  return days;
}

export type ExpiryState =
  | { kind: "none" }
  | { kind: "active"; remainingMs: number; remainingBusinessDays: number; dueAt: string }
  | { kind: "negotiating"; dueAt: string; reason: string }
  | { kind: "expired"; dueAt: string };

// Determine the effective expiry state for an RFQ given its status and dates.
// `negotiationActive` means there is an ongoing back-and-forth (status countered/quoted/etc),
// in which case the expiry is paused / extended rather than triggered.
export function computeExpiryState(args: {
  expiresAt?: string | null;
  responseDue?: string | null;
  status?: string;
  negotiationActive?: boolean;
  now?: Date;
}): ExpiryState {
  const dueRaw = args.expiresAt || args.responseDue;
  if (!dueRaw) return { kind: "none" };
  const now = args.now ?? new Date();
  const due = new Date(dueRaw);
  if (Number.isNaN(due.getTime())) return { kind: "none" };

  // Closed/awarded RFQs aren't subject to expiry.
  if (args.status === "awarded" || args.status === "accepted" || args.status === "closed") {
    return { kind: "none" };
  }

  if (now < due) {
    return {
      kind: "active",
      remainingMs: due.getTime() - now.getTime(),
      remainingBusinessDays: businessDaysBetween(now, due),
      dueAt: due.toISOString(),
    };
  }
  // Past the due date.
  if (args.negotiationActive || (args.status && (ACTIVE_NEGOTIATION_STATUSES as readonly string[]).includes(args.status))) {
    return {
      kind: "negotiating",
      dueAt: due.toISOString(),
      reason: "Negotiation ongoing \u2014 expiry paused / extended",
    };
  }
  return { kind: "expired", dueAt: due.toISOString() };
}

// Is the portal token currently valid?
export type TokenState =
  | { kind: "active"; expiresAt: string | null }
  | { kind: "expired"; expiresAt: string }
  | { kind: "revoked"; revokedAt: string }
  | { kind: "negotiating"; expiresAt: string };

export function computeTokenState(args: {
  tokenExpiresAt?: string | null;
  tokenRevokedAt?: string | null;
  inviteStatus?: string;
  now?: Date;
}): TokenState {
  if (args.tokenRevokedAt) {
    return { kind: "revoked", revokedAt: args.tokenRevokedAt };
  }
  const now = args.now ?? new Date();
  if (!args.tokenExpiresAt) {
    return { kind: "active", expiresAt: null };
  }
  const expires = new Date(args.tokenExpiresAt);
  if (Number.isNaN(expires.getTime()) || now < expires) {
    return { kind: "active", expiresAt: args.tokenExpiresAt };
  }
  // Past expiry. If invite is in active negotiation / awarded / closed, keep it accessible.
  const status = args.inviteStatus ?? "";
  const stillUseful =
    (ACTIVE_NEGOTIATION_STATUSES as readonly string[]).includes(status) ||
    status === "awarded" ||
    status === "accepted" ||
    status === "closed" ||
    status === "declined";
  if (stillUseful) {
    return { kind: "negotiating", expiresAt: args.tokenExpiresAt };
  }
  return { kind: "expired", expiresAt: args.tokenExpiresAt };
}
