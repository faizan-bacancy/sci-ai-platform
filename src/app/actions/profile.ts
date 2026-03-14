"use server";

import { createClient } from "@/lib/supabase/server";
import { updateProfileNameSchema } from "@/lib/validation/profile";

type ActionResult = { ok: true } | { ok: false; message: string };

export async function updateProfileNameAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = updateProfileNameSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false, message: "You must be logged in." };
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ name: parsed.data.name })
    .eq("id", user.id);

  if (updateError) {
    return { ok: false, message: updateError.message };
  }

  const { error: auditError } = await supabase.from("audit_logs").insert({
    actor_user_id: user.id,
    action: "profile.update_name",
    entity_type: "profiles",
    entity_id: user.id,
    metadata: { name: parsed.data.name },
  });

  if (auditError) {
    return { ok: false, message: auditError.message };
  }

  return { ok: true };
}

