import { useQuery } from "@tanstack/react-query";
import { Mail, KeyRound, MailQuestion, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/lib/role-context";
import type { User } from "@shared/schema";
import type { Role } from "@shared/roles";
import { ROLE_ICONS, ROLE_LABELS, LOGIN_ORDER, describeUserAccess } from "@/lib/role-labels";

const PROVIDER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  microsoft: Mail,
  google: Mail,
  magic_link: MailQuestion,
  demo: KeyRound,
};

const PROVIDER_LABELS: Record<string, string> = {
  microsoft: "Microsoft / Outlook (demo)",
  google: "Google / external (demo)",
  magic_link: "Magic link (demo)",
  demo: "Demo password-less",
};

export function LoginPanel() {
  const { signIn } = useAuth();
  const usersQuery = useQuery<User[]>({ queryKey: ["/api/users"] });

  const users = (usersQuery.data ?? []).slice().sort((a, b) => {
    return (LOGIN_ORDER[a.role as Role] ?? 99) - (LOGIN_ORDER[b.role as Role] ?? 99);
  });

  return (
    <main
      className="min-h-screen w-full bg-background"
      data-testid="page-login"
    >
      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 md:py-14">
        <header className="grid gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
              <svg aria-label="RFQ system logo" viewBox="0 0 32 32" className="h-6 w-6" fill="none">
                <path d="M7 8.5h18M7 16h18M7 23.5h11" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                <path d="M21.5 20.5l2 2 4-5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">QuoteDesk · TEG RFQ system</p>
              <h1 className="text-xl font-semibold" data-testid="text-login-title">
                Sign in
              </h1>
            </div>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            This preview ships demo accounts only. Production wires Microsoft Entra (Outlook) for internal users
            and Google / magic-link for external subcontractors. See{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">AUTHENTICATION_SETUP.md</code> for the
            redirect URI placeholders, env vars, and provider mapping.
          </p>
          <div
            className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30"
            data-testid="note-auth-setup"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700 dark:text-amber-300" />
            <div className="text-amber-900 dark:text-amber-100">
              <span className="font-medium">Preview-only login.</span> No real Microsoft / Google secrets are
              required. Picking an account just sets <code>x-rfq-user-id</code> for API calls. Refresh resets
              login on purpose.
            </div>
          </div>
        </header>

        <Separator />

        <section className="grid gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Demo accounts
          </h2>
          {usersQuery.isLoading && (
            <div
              className="grid gap-3 sm:grid-cols-2"
              data-testid="state-login-loading"
              aria-busy="true"
            >
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}>
                  <CardHeader>
                    <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                    <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-muted" />
                  </CardHeader>
                  <CardContent>
                    <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {!usersQuery.isLoading && (
            <div className="grid gap-3 sm:grid-cols-2" data-testid="list-login-accounts">
              {users.map((user) => {
                const RoleIcon = ROLE_ICONS[user.role as Role] ?? KeyRound;
                const ProviderIcon = PROVIDER_ICONS[user.authProvider] ?? KeyRound;
                const disabled = !user.active;
                return (
                  <Card
                    key={user.id}
                    className={
                      disabled
                        ? "border-muted opacity-70"
                        : "border-primary/20 transition hover:border-primary/40"
                    }
                    data-testid={`card-login-user-${user.id}`}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
                            <RoleIcon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <CardTitle
                              className="text-base"
                              data-testid={`text-login-user-name-${user.id}`}
                            >
                              {user.name}
                            </CardTitle>
                            <CardDescription
                              className="truncate"
                              data-testid={`text-login-user-email-${user.id}`}
                            >
                              {user.email}
                            </CardDescription>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <Badge variant="secondary" className="font-normal">
                            {ROLE_LABELS[user.role as Role] ?? user.role}
                          </Badge>
                          {disabled && (
                            <Badge
                              variant="outline"
                              className="border-amber-300 text-amber-800 dark:border-amber-700 dark:text-amber-200"
                              data-testid={`badge-login-inactive-${user.id}`}
                            >
                              Inactive
                            </Badge>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="grid gap-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <ProviderIcon className="h-3.5 w-3.5" />
                        <span data-testid={`text-login-user-provider-${user.id}`}>
                          {PROVIDER_LABELS[user.authProvider] ?? user.authProvider}
                        </span>
                        <span aria-hidden>·</span>
                        <span>{user.userType === "internal" ? "Internal" : "External"}</span>
                        {user.role === "commercial_staff" && (
                          <>
                            <span aria-hidden>·</span>
                            <span data-testid={`text-login-user-grant-${user.id}`}>
                              Grant: {user.commercialGrant ? "ON" : "OFF"}
                            </span>
                          </>
                        )}
                      </div>
                      <p
                        className="text-xs text-muted-foreground"
                        data-testid={`text-login-user-access-${user.id}`}
                      >
                        Your access: {describeUserAccess({
                          role: user.role as Role,
                          clusterName: user.clusterName,
                          companyId: user.companyId,
                          factoryId: user.factoryId,
                          subcontractorId: user.subcontractorId,
                          scopeType: user.scopeType,
                        })}
                      </p>
                      <Button
                        size="sm"
                        onClick={() => signIn(user)}
                        disabled={disabled}
                        data-testid={`button-login-user-${user.id}`}
                      >
                        {disabled ? "Account inactive" : "Sign in"}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
