"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublishableKey, getSupabaseUrl } from "./config";

export function createClient(): SupabaseClient {
  return createBrowserClient(getSupabaseUrl(), getSupabasePublishableKey());
}

