import { BookOpen, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AuthSetupNote() {
  return (
    <Card
      id="auth-setup-note"
      className="border-dashed border-primary/30 bg-primary/5"
      data-testid="card-auth-setup"
    >
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-base">Auth-ready, not real auth</CardTitle>
            <CardDescription>
              Demo accounts only — refresh resets login. Production wiring is described in
              {" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">AUTHENTICATION_SETUP.md</code>.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent
        className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2"
        data-testid="text-auth-setup-body"
      >
        <div>
          <p className="font-medium text-foreground">Internal users · Microsoft Entra (Outlook)</p>
          <p className="mt-1">
            Set <code className="rounded bg-muted px-1 py-0.5 text-xs">MS_TENANT_ID</code>,
            {" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">MS_CLIENT_ID</code>, and
            {" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">MS_CLIENT_SECRET</code> on the server. Add a
            redirect URI like{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">https://&lt;host&gt;/auth/microsoft/callback</code>.
            On callback, look up the email in the user directory; create or update with
            {" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">authProvider=microsoft</code>.
          </p>
        </div>
        <div>
          <p className="font-medium text-foreground">External users · Google + magic link</p>
          <p className="mt-1">
            Set <code className="rounded bg-muted px-1 py-0.5 text-xs">GOOGLE_CLIENT_ID</code>,
            {" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">GOOGLE_CLIENT_SECRET</code>,
            {" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">MAGIC_LINK_SIGNING_SECRET</code>,
            {" "}
            and an <code className="rounded bg-muted px-1 py-0.5 text-xs">SMTP_*</code> set for outbound mail.
            Subcontractors keep using tokenized portal links — magic link is a fallback for self-service signin.
          </p>
        </div>
        <div className="md:col-span-2 flex items-center gap-2 text-xs">
          <BookOpen className="h-3.5 w-3.5" />
          <span>
            No secrets are required in the preview. The server prefers{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">x-rfq-user-id</code> when present and
            falls back to legacy <code className="rounded bg-muted px-1 py-0.5 text-xs">x-rfq-role</code>{" "}
            headers for compatibility with existing tests.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
