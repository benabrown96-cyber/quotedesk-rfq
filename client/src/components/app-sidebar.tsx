import { ClipboardList, Handshake, MailCheck, Users } from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const items = [
  { title: "RFQ Workspace", url: "/", icon: ClipboardList },
  { title: "Subcontractors", url: "/", icon: Users },
  { title: "Responses", url: "/", icon: MailCheck },
  { title: "Negotiations", url: "/", icon: Handshake },
];

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-5">
        <div className="flex items-center gap-3" data-testid="brand-rfq-system">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <svg aria-label="RFQ system logo" viewBox="0 0 32 32" className="h-6 w-6" fill="none">
              <path d="M7 8.5h18M7 16h18M7 23.5h11" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              <path d="M21.5 20.5l2 2 4-5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">QuoteDesk</p>
            <p className="text-xs text-muted-foreground">RFQ control centre</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workflow</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location === item.url}>
                    <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replaceAll(" ", "-")}`}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
