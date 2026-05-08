import { useMutation, useQuery } from "@tanstack/react-query";
import { Network } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/lib/role-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { RolePerms, type Role } from "@shared/roles";
import { CLUSTERS, RFQ_CATEGORY_META, type RfqCategory, type Subcontractor } from "@shared/schema";

const CLUSTERS_CLIENT = CLUSTERS as readonly string[];

function isAvailable(list: string[], cluster: string) {
  if (!list || list.length === 0) return true;
  return list.includes(cluster);
}

export function SubcontractorClusterAccessPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const subsQuery = useQuery<Subcontractor[]>({
    queryKey: ["/api/subcontractors"],
    enabled:
      Boolean(user) && RolePerms.canEditSubcontractorClusterAccess(user?.role as Role),
  });

  const updateAccess = useMutation({
    mutationFn: async (vars: { id: number; clusterAccess: string[] }) => {
      const res = await apiRequest("PATCH", `/api/subcontractors/${vars.id}/cluster-access`, {
        clusterAccess: vars.clusterAccess,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractors"] });
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not update cluster availability",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  if (!user || !RolePerms.canEditSubcontractorClusterAccess(user.role as Role)) return null;
  const subs = subsQuery.data ?? [];

  return (
    <Card data-testid="card-subcontractor-cluster-access" className="border-primary/20">
      <CardHeader className="flex flex-row items-start gap-3 pb-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
          <Network className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <CardTitle className="text-base">Vendor availability</CardTitle>
          <CardDescription>
            Manufacturing subcontractors and material / service suppliers across both clusters.
            Senior Management or Platform Admin can adjust cluster availability here. Country routing
            rules (e.g. India under Growrite) and the vendor’s supported categories still apply on top.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>Type / categories</TableHead>
                <TableHead>Country</TableHead>
                {CLUSTERS_CLIENT.map((cluster) => (
                  <TableHead key={cluster}>{cluster}</TableHead>
                ))}
                <TableHead>Effective availability</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subs.map((sub) => {
                const list = sub.clusterAccess ?? [];
                return (
                  <TableRow key={sub.id} data-testid={`row-cluster-access-${sub.id}`}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium" data-testid={`text-sub-name-${sub.id}`}>{sub.name}</span>
                        <span className="text-xs text-muted-foreground">{sub.specialty}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1" data-testid={`badges-vendor-categories-${sub.id}`}>
                        <Badge
                          variant={sub.vendorType === "manufacturing_subcontractor" ? "secondary" : "outline"}
                          className="text-[10px] font-normal"
                        >
                          {sub.vendorType === "manufacturing_subcontractor" ? "Manufacturing" : "Supplier"}
                        </Badge>
                        {sub.vendorType === "supplier" &&
                          (sub.supportedCategories && sub.supportedCategories.length > 0
                            ? sub.supportedCategories.map((c) => (
                                <Badge key={c} variant="outline" className="text-[10px] font-normal">
                                  {RFQ_CATEGORY_META[c as RfqCategory]?.shortLabel ?? c}
                                </Badge>
                              ))
                            : (
                                <Badge variant="outline" className="text-[10px] font-normal">
                                  {RFQ_CATEGORY_META.other_supplies.shortLabel}
                                </Badge>
                              ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal">{sub.country}</Badge>
                    </TableCell>
                    {CLUSTERS_CLIENT.map((cluster) => {
                      const available = isAvailable(list, cluster);
                      return (
                        <TableCell key={cluster}>
                          <Checkbox
                            checked={available}
                            data-testid={`checkbox-cluster-${cluster.replace(/[^a-z]/gi, "")}-${sub.id}`}
                            onCheckedChange={(checked) => {
                              const wasBoth = list.length === 0;
                              const concrete: string[] = wasBoth
                                ? [...CLUSTERS_CLIENT]
                                : list.slice();
                              const idx = concrete.indexOf(cluster);
                              if (checked && idx === -1) concrete.push(cluster);
                              if (!checked && idx !== -1) concrete.splice(idx, 1);
                              // If both clusters are present, store [] to keep semantics tidy.
                              const next =
                                concrete.length === CLUSTERS_CLIENT.length ? [] : concrete;
                              updateAccess.mutate({ id: sub.id, clusterAccess: next });
                            }}
                          />
                        </TableCell>
                      );
                    })}
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className="font-normal"
                        data-testid={`badge-effective-availability-${sub.id}`}
                      >
                        {list.length === 0
                          ? "Both clusters"
                          : list.length === 1
                            ? list[0]
                            : "Both clusters"}
                      </Badge>
                    </TableCell>
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
