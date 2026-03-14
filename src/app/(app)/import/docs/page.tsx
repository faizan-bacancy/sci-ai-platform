import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { ImportDocsPage } from "@/features/import/import-docs-page";

export default async function ImportDocsRoute() {
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

  return <ImportDocsPage />;
}
