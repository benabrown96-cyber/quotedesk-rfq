import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/role-context";
import type { Role } from "@shared/roles";
import type { Company, Factory } from "@shared/schema";
import { ROLE_ICONS, ROLE_LABELS, describeUserAccess } from "@/lib/role-labels";

// Compact "Your access" summary shown at the top of the dashboard. Reads from the signed-in
// user record so the displayed scope is always derived from the user's role assignment, not
// from any client-side guess. This is the visible side of role-based section gating: every
// API endpoint is enforced server-side using role + scope from the same user record.
export function YourAccessCard() {
  const { user } = useAuth();
  const companiesQuery = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const factoriesQuery = useQuery<Factory[]>({ queryKey: ["/api/factories"] });

  if (!user) return null;
  const role = user.role as Role;
  const Icon = ROLE_ICONS[role];

  const company = user.companyId
    ? companiesQuery.data?.find((c) => c.id === user.companyId)
    : null;
  const factory = user.factoryId
    ? factoriesQuery.data?.find((f) => f.id === user.factoryId)
    : null;

  const description = describeUserAccess({
    role,
    clusterName: user.clusterName ?? company?.clusterName,
    companyId: user.companyId,
    factoryId: user.factoryId,
    subcontractorId: user.subcontractorId,
    scopeType: user.scopeType,
  });

  return (
    <Card data-testid="card-your-access" className="border-primary/20">
      <CardHeader className="flex flex-row items-start gap-3 pb-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <CardTitle className="text-base" data-testid="text-your-access-name">
            {user.name} <span className="text-muted-foreground font-normal">— {ROLE_LABELS[role]}</span>
          </CardTitle>
          <CardDescription data-testid="text-your-access-description">
            {description}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-normal" data-testid="badge-your-access-role">
            Role: {ROLE_LABELS[role]}
          </Badge>
          {user.clusterName && (
            <Badge variant="outline" className="font-normal" data-testid="badge-your-access-cluster">
              Cluster: {user.clusterName}
            </Badge>
          )}
          {company && (
            <Badge variant="outline" className="font-normal" data-testid="badge-your-access-company">
              Company: {company.name}
            </Badge>
          )}
          {factory && (
            <Badge variant="outline" className="font-normal" data-testid="badge-your-access-factory">
              Factory: {factory.name}
            </Badge>
          )}
          <Badge variant="outline" className="font-normal" data-testid="badge-your-access-scope-type">
            <Lock className="mr-1 h-3 w-3" /> Scope type: {user.scopeType}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
