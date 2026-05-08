// Single source of truth for role display in the client.
// Keeps copy consistent: never expose 'TEG Admin' as the business label.
// `group_admin` is the legacy alias for Senior Management; we display the same friendly name.
//
// The previous "buyer" role has been retired — its responsibilities are now
// covered by Senior Management, Commercial Manager, and Commercial Staff.
// Any incoming role string of "buyer" is normalized to "commercial_staff"
// at the API/storage boundary (see normalizeLegacyRole in shared/roles.ts).

import { ShieldCheck, Briefcase, Factory, Globe2, Wrench, BadgeCheck } from "lucide-react";
import type { Role } from "@shared/roles";
import type { ComponentType } from "react";

export const ROLE_ICONS: Record<Role, ComponentType<{ className?: string }>> = {
  senior_management: ShieldCheck,
  platform_admin: Wrench,
  commercial_manager: BadgeCheck,
  group_admin: ShieldCheck, // legacy alias
  commercial_staff: Briefcase,
  factory_user: Factory,
  subcontractor_user: Globe2,
};

export const ROLE_LABELS: Record<Role, string> = {
  senior_management: "Senior Management",
  platform_admin: "Platform Admin",
  commercial_manager: "Commercial Manager",
  group_admin: "Senior Management", // legacy alias — never display as 'TEG Admin'
  commercial_staff: "Commercial Staff",
  factory_user: "Factory User",
  subcontractor_user: "Subcontractor",
};

export const ROLE_SHORT_LABELS: Record<Role, string> = {
  senior_management: "Senior Mgmt",
  platform_admin: "Platform Admin",
  commercial_manager: "Commercial Mgr",
  group_admin: "Senior Mgmt",
  commercial_staff: "Commercial",
  factory_user: "Factory",
  subcontractor_user: "Subcontractor",
};

// Role ordering used by the login picker.
export const LOGIN_ORDER: Record<Role, number> = {
  senior_management: 0,
  group_admin: 0, // shown right alongside SM
  platform_admin: 1,
  commercial_manager: 2,
  commercial_staff: 3,
  factory_user: 4,
  subcontractor_user: 5,
};

// Friendly description of a user's "Your access" — derives from role, scope, and cluster.
export function describeUserAccess(input: {
  role: Role;
  clusterName?: string | null;
  companyId?: number | null;
  factoryId?: number | null;
  subcontractorId?: number | null;
  scopeType?: string | null;
}): string {
  const { role, clusterName } = input;
  switch (role) {
    case "senior_management":
    case "group_admin":
      return "Group-wide business authority across all TEG clusters";
    case "platform_admin":
      return "Platform-wide IT / settings access — no commercial decisions";
    case "commercial_manager":
      return clusterName ? `Commercial oversight: ${clusterName} cluster` : "Commercial oversight: cluster scoped";
    case "commercial_staff":
      return clusterName ? `Commercial scope: ${clusterName} cluster` : "Commercial scope: company";
    case "factory_user":
      return "Factory scope: assigned factory only";
    case "subcontractor_user":
      return "Tokenized portal only — single invite";
    default:
      return "Restricted access";
  }
}
