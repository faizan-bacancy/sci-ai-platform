"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useProfile } from "@/components/app/profile-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { canWrite } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useAlertsStore } from "@/stores/alerts-store";
import { useUIStore } from "@/stores/ui-store";
import { navSections } from "./nav-items";

export function Sidebar({
  onNavigate,
  variant = "desktop",
}: {
  onNavigate?: () => void;
  variant?: "desktop" | "mobile";
}) {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleSidebarCollapsed } = useUIStore();
  const criticalUnacknowledgedCount = useAlertsStore((state) => state.criticalUnacknowledgedCount);
  const profile = useProfile();

  const isDesktop = variant === "desktop";
  const collapsed = isDesktop ? sidebarCollapsed : false;
  const canImport = canWrite(profile.role);

  const sections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => (item.href === "/import" ? canImport : true)),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <aside
      className={cn(
        "flex flex-col border-r bg-sidebar text-sidebar-foreground",
        isDesktop ? "hidden h-screen md:sticky md:top-0 md:flex md:self-start" : "h-full w-full",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-3">
        <div className={cn("font-semibold", collapsed && "sr-only")}>SupplyIQ</div>
        {isDesktop ? (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={toggleSidebarCollapsed}
            aria-label="Toggle sidebar"
          >
            {collapsed ? "»" : "«"}
          </Button>
        ) : null}
      </div>
      <Separator />
      <nav className="flex-1 space-y-4 p-2">
        {sections.map((section) => (
          <div key={section.label} className="space-y-1">
            <div
              className={cn(
                "px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                collapsed && "sr-only",
              )}
            >
              {section.label}
            </div>
            {section.items.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              const isAlertsItem = item.href === "/alerts";
              const showAlertsBadge = isAlertsItem && criticalUnacknowledgedCount > 0;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "hover:bg-sidebar-accent/60",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className={cn(collapsed && "sr-only")}>{item.label}</span>
                  {showAlertsBadge ? (
                    <Badge
                      variant="destructive"
                      className={cn(
                        "ml-auto min-w-5 justify-center px-1.5 text-[10px]",
                        collapsed && "min-w-4 px-1 text-[9px]",
                      )}
                    >
                      {criticalUnacknowledgedCount > 99 ? "99+" : criticalUnacknowledgedCount}
                    </Badge>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className={cn("p-3 text-xs text-muted-foreground", (collapsed || !isDesktop) && "sr-only")}>
        Phase 4 - Optimization & Alerts
      </div>
    </aside>
  );
}
