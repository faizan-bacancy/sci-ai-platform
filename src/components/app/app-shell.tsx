"use client";

import type { Profile } from "@/lib/types";
import { AlertsRealtimeBridge } from "./alerts-realtime-bridge";
import { MobileSidebar } from "./mobile-sidebar";
import { ProfileProvider } from "./profile-context";
import { Sidebar } from "./sidebar";
import { TopNav } from "./top-nav";

export function AppShell({
  profile,
  children,
}: {
  profile: Profile;
  children: React.ReactNode;
}) {
  return (
    <ProfileProvider profile={profile}>
      <div className="min-h-screen bg-background">
        <AlertsRealtimeBridge />
        <div className="flex">
          <Sidebar />
          <MobileSidebar />
          <div className="min-w-0 flex-1">
            <TopNav profile={profile} />
            <main className="px-4 py-6 md:px-6">{children}</main>
          </div>
        </div>
      </div>
    </ProfileProvider>
  );
}
