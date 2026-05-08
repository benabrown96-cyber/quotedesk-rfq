import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Settings2, Save } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/lib/role-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  RolePerms,
  type Role,
} from "@shared/roles";
import type { SystemSettings } from "@shared/schema";

// Format the active default window. "1 calendar day" reads naturally as "24 hours";
// surface that hint inline so admins immediately see the ETD turn-around.
function formatWindowLabel(days: number, mode: "business" | "calendar"): string {
  const unit = mode === "calendar" ? "calendar" : "business";
  const base = `${days} ${unit} day${days === 1 ? "" : "s"}`;
  if (days === 1 && mode === "calendar") return `${base} (24 hours)`;
  return base;
}

export function SystemSettingsPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const settingsQuery = useQuery<SystemSettings>({
    queryKey: ["/api/settings"],
    enabled: Boolean(user) && RolePerms.canEditSystemSettings(user?.role as Role),
  });

  // Defaults align with the system: 1 calendar day (~24h) initial response;
  // 7 calendar days for the overall deal close target.
  const [days, setDays] = useState<number>(1);
  const [mode, setMode] = useState<"business" | "calendar">("calendar");
  const [closeDays, setCloseDays] = useState<number>(7);
  const [closeMode, setCloseMode] = useState<"business" | "calendar">("calendar");

  useEffect(() => {
    if (settingsQuery.data) {
      setDays(settingsQuery.data.responseDefaultDays);
      setMode(settingsQuery.data.responseDayMode);
      setCloseDays(settingsQuery.data.dealCloseDefaultDays);
      setCloseMode(settingsQuery.data.dealCloseDayMode);
    }
  }, [settingsQuery.data]);

  const updateSettings = useMutation({
    mutationFn: async (patch: {
      responseDefaultDays?: number;
      responseDayMode?: "business" | "calendar";
      dealCloseDefaultDays?: number;
      dealCloseDayMode?: "business" | "calendar";
    }) => {
      const res = await apiRequest("PATCH", "/api/settings", patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Settings updated", description: "New RFQs will use these windows." });
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not update settings",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  if (!user || !RolePerms.canEditSystemSettings(user.role as Role)) return null;

  const dirty =
    settingsQuery.data &&
    (settingsQuery.data.responseDefaultDays !== days ||
      settingsQuery.data.responseDayMode !== mode ||
      settingsQuery.data.dealCloseDefaultDays !== closeDays ||
      settingsQuery.data.dealCloseDayMode !== closeMode);

  return (
    <Card data-testid="card-system-settings" className="border-primary/20">
      <CardHeader className="flex flex-row items-start gap-3 pb-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
          <Settings2 className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <CardTitle className="text-base">System settings</CardTitle>
          <CardDescription>
            Senior Management or Platform Admin can change the default RFQ deadlines.
            Initial response is 24 hours; deal should be closed within 7 days from RFQ
            creation. Existing RFQs keep their original deadlines; new RFQs use the
            values below.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-1">
          <div className="text-xs font-medium text-muted-foreground">Initial response window</div>
          <div className="text-xs text-muted-foreground">
            How long suppliers / factories have to respond after an RFQ is sent.
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="settings-default-days">Default response days</Label>
            <Input
              id="settings-default-days"
              type="number"
              min={1}
              max={60}
              value={days}
              onChange={(e) => setDays(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
              data-testid="input-settings-default-days"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="settings-day-mode">Day mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as "business" | "calendar")}>
              <SelectTrigger id="settings-day-mode" data-testid="select-settings-day-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="business">Business days (skip weekends)</SelectItem>
                <SelectItem value="calendar">Calendar days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Separator />

        <div className="grid gap-1">
          <div className="text-xs font-medium text-muted-foreground">Deal close target</div>
          <div className="text-xs text-muted-foreground">
            Overall close-by deadline measured from RFQ creation. RFQs not awarded or closed
            past this window are flagged "Deal close overdue" on the dashboard. Default 7
            calendar days.
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="settings-close-days">Default close-by days</Label>
            <Input
              id="settings-close-days"
              type="number"
              min={1}
              max={180}
              value={closeDays}
              onChange={(e) => setCloseDays(Math.max(1, Math.min(180, Number(e.target.value) || 1)))}
              data-testid="input-settings-close-days"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="settings-close-mode">Day mode</Label>
            <Select value={closeMode} onValueChange={(v) => setCloseMode(v as "business" | "calendar")}>
              <SelectTrigger id="settings-close-mode" data-testid="select-settings-close-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="business">Business days (skip weekends)</SelectItem>
                <SelectItem value="calendar">Calendar days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <div className="text-xs text-muted-foreground">
            <div>
              Initial response:{" "}
              <Badge variant="secondary" className="font-normal" data-testid="badge-current-window">
                {settingsQuery.data
                  ? formatWindowLabel(settingsQuery.data.responseDefaultDays, settingsQuery.data.responseDayMode)
                  : "loading…"}
              </Badge>
            </div>
            <div className="mt-1">
              Deal close target:{" "}
              <Badge variant="secondary" className="font-normal" data-testid="badge-current-close-window">
                {settingsQuery.data
                  ? formatWindowLabel(settingsQuery.data.dealCloseDefaultDays, settingsQuery.data.dealCloseDayMode)
                  : "loading…"}
              </Badge>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() =>
              updateSettings.mutate({
                responseDefaultDays: days,
                responseDayMode: mode,
                dealCloseDefaultDays: closeDays,
                dealCloseDayMode: closeMode,
              })
            }
            disabled={!dirty || updateSettings.isPending}
            data-testid="button-save-settings"
          >
            <Save className="mr-1.5 h-3.5 w-3.5" />
            Save settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
