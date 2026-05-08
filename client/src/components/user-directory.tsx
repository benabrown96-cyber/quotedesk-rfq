import { useMutation, useQuery } from "@tanstack/react-query";
import { ShieldCheck, BookOpen, Mail, KeyRound, MailQuestion } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/lib/role-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { User } from "@shared/schema";
import { ROLES, RolePerms, type Role } from "@shared/roles";
import { useToast } from "@/hooks/use-toast";
import { ROLE_LABELS } from "@/lib/role-labels";

// Roles that can be assigned via the UI — hide the legacy group_admin alias from the dropdown
// (existing rows still load, but new assignments use senior_management).
const ASSIGNABLE_ROLES: Role[] = ROLES.filter((r) => r !== "group_admin") as Role[];

const PROVIDER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  microsoft: Mail,
  google: Mail,
  magic_link: MailQuestion,
  demo: KeyRound,
};

function PermissionCell({
  enabled,
  checked,
  disabled,
  ariaLabel,
  testId,
  onChange,
}: {
  enabled: boolean;
  checked: boolean;
  disabled?: boolean;
  ariaLabel: string;
  testId: string;
  onChange: (checked: boolean) => void;
}) {
  if (!enabled) {
    return (
      <TableCell>
        <span className="text-xs text-muted-foreground">—</span>
      </TableCell>
    );
  }
  return (
    <TableCell>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={ariaLabel}
        data-testid={testId}
      />
    </TableCell>
  );
}

export function UserDirectory() {
  const { user } = useAuth();
  const { toast } = useToast();
  const usersQuery = useQuery<User[]>({ queryKey: ["/api/users"] });

  const updateUser = useMutation({
    mutationFn: async (vars: { id: number; patch: Partial<User> }) => {
      const res = await apiRequest("PATCH", `/api/users/${vars.id}`, vars.patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not update user",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  if (!user || !RolePerms.canManageUsers(user.role as Role)) return null;

  const all = (usersQuery.data ?? []).slice().sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <Card data-testid="card-user-directory" className="border-primary/20">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-base">User directory</CardTitle>
            <CardDescription>
              Senior Management or Platform Admin can change role assignments and toggle active state.
              Granular commercial-staff permissions (send RFQs, negotiate, recommend awards) can be
              granted independently. Production wiring lives in{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">AUTHENTICATION_SETUP.md</code>.
            </CardDescription>
          </div>
        </div>
        <a
          className="hidden items-center gap-1 text-xs text-muted-foreground hover:text-primary md:inline-flex"
          href="#auth-setup-note"
          data-testid="link-auth-setup"
        >
          <BookOpen className="h-3.5 w-3.5" /> Setup guide
        </a>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role / scope</TableHead>
                <TableHead>Assign role</TableHead>
                <TableHead className="hidden md:table-cell">Provider</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Send RFQs</TableHead>
                <TableHead>Negotiate</TableHead>
                <TableHead>Recommend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {all.map((row) => {
                const ProviderIcon = PROVIDER_ICONS[row.authProvider] ?? KeyRound;
                const isCommercial = row.role === "commercial_staff";
                return (
                  <TableRow key={row.id} data-testid={`row-user-${row.id}`}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium" data-testid={`text-user-name-${row.id}`}>
                          {row.name}
                        </span>
                        <span className="text-xs text-muted-foreground" data-testid={`text-user-email-${row.id}`}>
                          {row.email}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant="secondary" className="w-fit font-normal">
                          {ROLE_LABELS[row.role as Role] ?? row.role}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {row.userType === "internal" ? "Internal" : "External"}
                          {row.clusterName ? ` · ${row.clusterName}` : ""}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={row.role}
                        onValueChange={(value) => {
                          if (value === row.role) return;
                          updateUser.mutate({ id: row.id, patch: { role: value } as any });
                        }}
                      >
                        <SelectTrigger
                          className="h-8 w-[180px]"
                          data-testid={`select-role-${row.id}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ASSIGNABLE_ROLES.map((r) => (
                            <SelectItem key={r} value={r} data-testid={`role-option-${r}-${row.id}`}>
                              {ROLE_LABELS[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span
                        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                        data-testid={`text-user-provider-${row.id}`}
                      >
                        <ProviderIcon className="h-3.5 w-3.5" />
                        {row.authProvider}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={Boolean(row.active)}
                          onCheckedChange={(checked) =>
                            updateUser.mutate({ id: row.id, patch: { active: checked } })
                          }
                          aria-label={`Toggle active state for ${row.name}`}
                          data-testid={`switch-active-${row.id}`}
                        />
                        <Label className="text-xs text-muted-foreground" data-testid={`text-user-active-${row.id}`}>
                          {row.active ? "Active" : "Disabled"}
                        </Label>
                      </div>
                    </TableCell>
                    <PermissionCell
                      enabled={isCommercial}
                      checked={Boolean((row as any).canSendRfqs ?? row.commercialGrant)}
                      disabled={!row.active}
                      ariaLabel={`Toggle send-RFQs for ${row.name}`}
                      testId={`switch-can-send-rfqs-${row.id}`}
                      onChange={(checked) =>
                        updateUser.mutate({ id: row.id, patch: { canSendRfqs: checked } as any })
                      }
                    />
                    <PermissionCell
                      enabled={isCommercial}
                      checked={Boolean((row as any).canNegotiate ?? row.commercialGrant)}
                      disabled={!row.active}
                      ariaLabel={`Toggle negotiate for ${row.name}`}
                      testId={`switch-can-negotiate-${row.id}`}
                      onChange={(checked) =>
                        updateUser.mutate({ id: row.id, patch: { canNegotiate: checked } as any })
                      }
                    />
                    <PermissionCell
                      enabled={isCommercial}
                      checked={Boolean((row as any).canRecommendAwards ?? row.commercialGrant)}
                      disabled={!row.active}
                      ariaLabel={`Toggle recommend-awards for ${row.name}`}
                      testId={`switch-can-recommend-awards-${row.id}`}
                      onChange={(checked) =>
                        updateUser.mutate({ id: row.id, patch: { canRecommendAwards: checked } as any })
                      }
                    />
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
