"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { navSections } from "./nav-items";
import { useUIStore } from "@/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useProfile } from "@/components/app/profile-context";
import { canWrite } from "@/lib/permissions";

export function Sidebar({
  onNavigate,
  variant = "desktop",
}: {
  onNavigate?: () => void;
  variant?: "desktop" | "mobile";
}) {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleSidebarCollapsed } = useUIStore();
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
        isDesktop ? "hidden h-screen md:flex" : "h-full w-full",
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
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className={cn("p-3 text-xs text-muted-foreground", (collapsed || !isDesktop) && "sr-only")}>
        Phase 3 - Import & Export
      </div>
    </aside>
  );
}
