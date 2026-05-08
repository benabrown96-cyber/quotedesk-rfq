import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Moon, PanelLeft, Sun } from "lucide-react";
import { Route, Router, Switch } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { AppSidebar } from "@/components/app-sidebar";
import { AccountSwitcher } from "@/components/account-switcher";
import { LoginPanel } from "@/components/login-panel";
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "./lib/queryClient";
import { AuthProvider, useAuth } from "@/lib/role-context";
import { ROLE_PERSONAS } from "@shared/roles";
import Home from "@/pages/home";
import NotFound from "@/pages/not-found";
import Portal from "@/pages/portal";
import VendorDashboard from "@/pages/vendor-dashboard";

function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      data-testid="button-theme-toggle"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

// Vendor / subcontractor users get a slim shell — no sidebar (which carries
// internal navigation labels), just the header with sign-out + theme toggle
// and the restricted VendorDashboard. They cannot reach the internal Home page
// because the API also rejects every endpoint outside the vendor allow-list.
function VendorShell() {
  const { user, signOut } = useAuth();
  const persona =
    ROLE_PERSONAS.find((p) => p.role === "subcontractor_user") ?? ROLE_PERSONAS[0];
  return (
    <div className="flex min-h-screen w-full bg-background" data-testid="shell-vendor">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background/90 px-4 backdrop-blur">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"
              aria-hidden="true"
            >
              <svg viewBox="0 0 32 32" className="h-5 w-5" fill="none">
                <path d="M7 8.5h18M7 16h18M7 23.5h11" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                <path d="M21.5 20.5l2 2 4-5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">RFQ system</p>
              <p className="truncate text-xs text-muted-foreground" data-testid="text-active-role">
                Acting as {persona.shortLabel}
                {user ? ` · ${user.name}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={signOut}
              data-testid="button-vendor-sign-out"
            >
              Sign out
            </Button>
            <ThemeToggle />
          </div>
        </header>
        <VendorDashboard />
      </div>
    </div>
  );
}

function InternalShell() {
  const { user, role } = useAuth();
  if (!user) {
    return <LoginPanel />;
  }
  if (role === "subcontractor_user") {
    return <VendorShell />;
  }
  const persona = ROLE_PERSONAS.find((p) => p.role === role) ?? ROLE_PERSONAS[0];

  const style = {
    "--sidebar-width": "18rem",
    "--sidebar-width-icon": "4rem",
  } as CSSProperties;

  return (
    <SidebarProvider style={style}>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background/90 px-4 backdrop-blur">
            <div className="flex items-center gap-3">
              <SidebarTrigger data-testid="button-sidebar-toggle">
                <PanelLeft className="h-4 w-4" />
              </SidebarTrigger>
              <div>
                <p className="text-sm font-semibold">RFQ system</p>
                <p className="text-xs text-muted-foreground" data-testid="text-active-role">
                  Acting as {persona.shortLabel}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <AccountSwitcher />
              <ThemeToggle />
            </div>
          </header>
          <Home />
        </div>
      </div>
    </SidebarProvider>
  );
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={InternalShell} />
      <Route path="/portal/:token" component={Portal} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Router hook={useHashLocation}>
            <AppRouter />
          </Router>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
