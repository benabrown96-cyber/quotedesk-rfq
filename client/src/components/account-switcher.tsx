import { useQuery } from "@tanstack/react-query";
import { LogOut, ChevronsUpDown, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/role-context";
import { queryClient } from "@/lib/queryClient";
import type { User } from "@shared/schema";
import type { Role } from "@shared/roles";
import { ROLE_ICONS, ROLE_SHORT_LABELS } from "@/lib/role-labels";

export function AccountSwitcher() {
  const { user, signIn, signOut } = useAuth();
  const usersQuery = useQuery<User[]>({ queryKey: ["/api/users"] });
  const all = usersQuery.data ?? [];
  const Icon = user ? ROLE_ICONS[user.role as Role] : ShieldCheck;

  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2"
          data-testid="button-account-switcher"
        >
          <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/10 text-primary">
            <Icon className="h-3 w-3" />
          </span>
          <span className="hidden text-left sm:inline">
            <span className="block text-xs font-semibold leading-tight" data-testid="text-current-user-name">
              {user.name}
            </span>
            <span className="block text-[10px] font-normal leading-tight text-muted-foreground" data-testid="text-current-user-role">
              {ROLE_SHORT_LABELS[user.role as Role]}
            </span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72" data-testid="menu-account-switcher">
        <DropdownMenuLabel>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Switch demo account</span>
          <span className="block truncate text-sm font-medium" data-testid="text-current-user-email">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {all.map((candidate) => {
          const RoleIcon = ROLE_ICONS[candidate.role as Role] ?? ShieldCheck;
          const isCurrent = candidate.id === user.id;
          return (
            <DropdownMenuItem
              key={candidate.id}
              disabled={!candidate.active}
              onClick={() => {
                if (!candidate.active) return;
                signIn(candidate);
                queryClient.invalidateQueries();
              }}
              data-testid={`item-account-switch-${candidate.id}`}
            >
              <RoleIcon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{candidate.name}</p>
                <p className="truncate text-xs text-muted-foreground">{candidate.email}</p>
              </div>
              <div className="ml-2 flex items-center gap-1">
                {!candidate.active && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px]">Inactive</Badge>
                )}
                {isCurrent && (
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">Current</Badge>
                )}
              </div>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            signOut();
            queryClient.invalidateQueries();
          }}
          data-testid="button-sign-out"
        >
          <LogOut className="mr-2 h-3.5 w-3.5" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
