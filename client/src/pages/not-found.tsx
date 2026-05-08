import { AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <CardTitle>Page not found</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm text-muted-foreground">The RFQ page you are looking for is not registered in the app.</p>
          <Button asChild variant="outline">
            <Link href="/" data-testid="link-not-found-home">
              Return to RFQ dashboard
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
