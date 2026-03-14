import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { createClient } from "@/lib/supabase/server";
import type { Profile, UserRole } from "@/lib/types";

function fallbackName(email?: string | null) {
  if (!email) return "User";
  const local = email.split("@")[0];
  return local ? local : "User";
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id,name,email,role,is_active")
    .eq("id", user.id)
    .single();

  const appProfile: Profile = {
    id: user.id,
    name:
      profile?.name ??
      (user.user_metadata as { name?: string } | undefined)?.name ??
      fallbackName(user.email),
    email: profile?.email ?? user.email ?? "",
    role: (profile?.role as UserRole | null) ?? "viewer",
    is_active: profile?.is_active ?? true,
  };

  return <AppShell profile={appProfile}>{children}</AppShell>;
}

