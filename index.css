import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ROLE_PERSONAS, type Role } from "@shared/roles";
import { useRole } from "@/lib/role-context";
import { queryClient } from "@/lib/queryClient";
import { ROLE_ICONS } from "@/lib/role-labels";

export function RoleSwitcher({ companies, factories }: {
  companies?: Array<{ id: number; name: string }>;
  factories?: Array<{ id: number; name: string }>;
}) {
  const { role, scopeId, commercialGrant, setRole, setScopeId, setCommercialGrant } = useRole();
  const persona = ROLE_PERSONAS.find((p) => p.role === role)!;
  const Icon = ROLE_ICONS[role];

  const onRoleChange = (next: string) => {
    setRole(next as Role);
    queryClient.invalidateQueries();
  };

  const onScopeChange = (next: string) => {
    const id = next === "all" ? null : Number(next);
    setScopeId(id);
    queryClient.invalidateQueries();
  };

  const showScopePicker = persona.scopeKind === "company" || persona.scopeKind === "factory";
  const scopeOptions = persona.scopeKind === "company" ? companies : persona.scopeKind === "factory" ? factories : [];
  const isCommercial = role === "commercial_staff";

  return (
    <Card data-testid="card-role-switcher" className="border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
              <Icon className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base">Acting as: {persona.shortLabel}</CardTitle>
              <CardDescription>{persona.description}</CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={role} onValueChange={onRoleChange}>
              <SelectTrigger className="w-[260px]" data-testid="select-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_PERSONAS.map((p) => (
                  <SelectItem key={p.role} value={p.role} data-testid={`option-role-${p.role}`}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {showScopePicker && (
              <Select value={scopeId !== null ? String(scopeId) : "all"} onValueChange={onScopeChange}>
                <SelectTrigger className="w-[240px]" data-testid="select-role-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {persona.scopeKind === "company" && !isCommercial && (
                    <SelectItem value="all">All companies</SelectItem>
                  )}
                  {scopeOptions?.map((option) => (
                    <SelectItem key={option.id} value={String(option.id)}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap gap-2" data-testid="list-role-permissions">
          {persona.permissionsSummary.map((line, idx) => (
            <Badge key={idx} variant="secondary" className="font-normal">
              {line}
            </Badge>
          ))}
        </div>
        {isCommercial && (
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3"
            data-testid="region-commercial-grant"
          >
            <div className="flex items-start gap-3">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium" data-testid="text-commercial-grant-status">
                  Commercial allowance: {commercialGrant ? "GRANTED" : "NOT GRANTED"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Commercial staff can create RFQs by default. An allowance from Senior Management or a
                  Commercial Manager is required to send invites, negotiate, or recommend an award.
                  Acceptance, decline, and award stay with Senior Management.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="switch-commercial-grant" className="text-xs uppercase tracking-wide text-muted-foreground">
                Allow send / negotiate / recommend
              </Label>
              <Switch
                id="switch-commercial-grant"
                checked={commercialGrant}
                onCheckedChange={(checked) => {
                  setCommercialGrant(checked);
                  queryClient.invalidateQueries();
                }}
                data-testid="switch-commercial-grant"
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
