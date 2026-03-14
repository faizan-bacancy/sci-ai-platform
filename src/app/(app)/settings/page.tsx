import { createClient } from "@/lib/supabase/server";
import { ProfileNameForm } from "@/components/settings/profile-name-form";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("name,email,role")
        .eq("id", user.id)
        .single()
    : { data: null };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Profile settings (Phase 1).</p>
      </div>
      <ProfileNameForm
        initialName={profile?.name ?? ""}
        email={profile?.email ?? user?.email ?? ""}
        role={(profile?.role as string | undefined) ?? "viewer"}
      />
    </div>
  );
}

