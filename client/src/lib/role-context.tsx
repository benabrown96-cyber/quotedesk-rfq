import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { isValidRole, normalizeLegacyRole, type Role } from "@shared/roles";
import type { User } from "@shared/schema";

// Auth context: in the preview, we keep the *currently signed-in user* in React state
// (no localStorage / cookies — sandbox refresh resets login on purpose). The user
// drives every API header. A legacy role-only mode is preserved for compatibility:
// when no user is signed in, callers can still set role/scope/grant directly.

type AuthState = {
  // Selected user in the preview. null when nobody is signed in (login screen visible).
  user: User | null;
  // Effective role/scope/grant used to build outbound headers.
  // Mirrors user when a user is signed in; falls back to manual values otherwise.
  role: Role;
  scopeId: number | null;
  commercialGrant: boolean;
  // Sign in / out
  signIn: (user: User) => void;
  signOut: () => void;
  // Legacy direct setters (kept for the role switcher that still ships in the codebase).
  setRole: (role: Role) => void;
  setScopeId: (id: number | null) => void;
  setCommercialGrant: (granted: boolean) => void;
  // Outbound headers helper
  headers: () => Record<string, string>;
};

const AuthContext = createContext<AuthState | null>(null);

// Module-level mirror so apiRequest/queryFn can read current auth state
// without prop-drilling into queryClient. Updated whenever signIn / signOut runs.
let currentSnapshot: {
  userId: number | null;
  role: Role;
  scopeId: number | null;
  commercialGrant: boolean;
} = {
  userId: null,
  role: "senior_management",
  scopeId: null,
  commercialGrant: false,
};

export function getCurrentRoleHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  // When a user is signed in, the user-id header is authoritative; the server resolves
  // role/scope/grant from the user directory. We still send the legacy headers so any
  // older guard that reads them keeps working.
  if (currentSnapshot.userId) {
    headers["x-rfq-user-id"] = String(currentSnapshot.userId);
  }
  headers["x-rfq-role"] = currentSnapshot.role;
  if (currentSnapshot.scopeId !== null && currentSnapshot.scopeId !== undefined) {
    headers["x-rfq-scope-id"] = String(currentSnapshot.scopeId);
  }
  if (currentSnapshot.commercialGrant) {
    headers["x-rfq-commercial-grant"] = "1";
  }
  return headers;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRoleState] = useState<Role>("senior_management");
  const [scopeId, setScopeIdState] = useState<number | null>(null);
  const [commercialGrant, setCommercialGrantState] = useState<boolean>(false);

  const syncSnapshot = useCallback(
    (next: {
      userId: number | null;
      role: Role;
      scopeId: number | null;
      commercialGrant: boolean;
    }) => {
      currentSnapshot = next;
    },
    [],
  );

  const signIn = useCallback(
    (next: User) => {
      // Defensive: normalize any legacy role strings (e.g. "buyer") arriving from
      // older API rows. The server already runs a migration, but we belt-and-brace
      // so the client never tries to render an unknown role.
      const normalized = normalizeLegacyRole(next.role) ?? next.role;
      const safeRole: Role = isValidRole(normalized) ? normalized : "commercial_staff";
      const fixedUser = { ...next, role: safeRole } as User;
      setUser(fixedUser);
      const r = safeRole;
      const s = next.scopeId ?? null;
      const g = Boolean(next.commercialGrant);
      setRoleState(r);
      setScopeIdState(s);
      setCommercialGrantState(g);
      syncSnapshot({ userId: next.id, role: r, scopeId: s, commercialGrant: g });
    },
    [syncSnapshot],
  );

  const signOut = useCallback(() => {
    setUser(null);
    setRoleState("senior_management");
    setScopeIdState(null);
    setCommercialGrantState(false);
    syncSnapshot({ userId: null, role: "senior_management", scopeId: null, commercialGrant: false });
  }, [syncSnapshot]);

  const setRole = useCallback(
    (next: Role) => {
      setRoleState(next);
      syncSnapshot({
        userId: user?.id ?? null,
        role: next,
        scopeId,
        commercialGrant,
      });
    },
    [user, scopeId, commercialGrant, syncSnapshot],
  );

  const setScopeId = useCallback(
    (id: number | null) => {
      setScopeIdState(id);
      syncSnapshot({
        userId: user?.id ?? null,
        role,
        scopeId: id,
        commercialGrant,
      });
    },
    [user, role, commercialGrant, syncSnapshot],
  );

  const setCommercialGrant = useCallback(
    (granted: boolean) => {
      setCommercialGrantState(granted);
      syncSnapshot({
        userId: user?.id ?? null,
        role,
        scopeId,
        commercialGrant: granted,
      });
    },
    [user, role, scopeId, syncSnapshot],
  );

  // Keep the snapshot in sync if anything else mutated state (defensive).
  useEffect(() => {
    syncSnapshot({
      userId: user?.id ?? null,
      role,
      scopeId,
      commercialGrant,
    });
  }, [user, role, scopeId, commercialGrant, syncSnapshot]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      role,
      scopeId,
      commercialGrant,
      signIn,
      signOut,
      setRole,
      setScopeId,
      setCommercialGrant,
      headers: () => {
        const h: Record<string, string> = {};
        if (user) h["x-rfq-user-id"] = String(user.id);
        h["x-rfq-role"] = role;
        if (scopeId !== null) h["x-rfq-scope-id"] = String(scopeId);
        if (commercialGrant) h["x-rfq-commercial-grant"] = "1";
        return h;
      },
    }),
    [user, role, scopeId, commercialGrant, signIn, signOut, setRole, setScopeId, setCommercialGrant],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Backwards-compatible export name so existing imports keep working.
export const RoleProvider = AuthProvider;

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

// Existing components import `useRole` — keep the name stable.
export const useRole = useAuth;
