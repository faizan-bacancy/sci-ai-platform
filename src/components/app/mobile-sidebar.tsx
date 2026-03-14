"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Sidebar } from "./sidebar";
import { useUIStore } from "@/stores/ui-store";

export function MobileSidebar() {
  const { mobileSidebarOpen, setMobileSidebarOpen } = useUIStore();

  return (
    <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="px-4 py-3">
          <SheetTitle>SupplyIQ</SheetTitle>
        </SheetHeader>
        <div className="h-[calc(100vh-56px)] border-t">
          <Sidebar
            variant="mobile"
            onNavigate={() => setMobileSidebarOpen(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
