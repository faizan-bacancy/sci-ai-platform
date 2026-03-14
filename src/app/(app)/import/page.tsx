import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { ImportCenterPage } from "@/features/import/import-center-page";

export default async function ImportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role === "viewer") {
    redirect("/dashboard");
  }

  return <ImportCenterPage />;
}
