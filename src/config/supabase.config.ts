import { createClient, SupabaseClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!url || !serviceKey || !anonKey) {
  throw new Error(
    `[Supabase] Keys missing — NODE_ENV: ${process.env.NODE_ENV}`,
  );
}

let adminInstance: SupabaseClient | null = null;

export const getSupabaseAdmin = (): SupabaseClient => {
  if (!adminInstance) {
    adminInstance = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    console.log(
      `[Supabase] Admin Connected to ${process.env.NODE_ENV?.toUpperCase()} DB`,
    );
  }
  return adminInstance;
};

export const getSupabaseClient = (userJwtToken: string): SupabaseClient => {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${userJwtToken}`,
      },
    },
  });
};
