import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "./config.js";

export function createSupabaseClient(config: AppConfig): SupabaseClient | null {
  if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) return null;
  return createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

export function createUserScopedClient(config: AppConfig, accessToken: string): SupabaseClient {
  if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
    throw new Error("Supabase authentication is not configured");
  }
  return createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false }
  });
}
