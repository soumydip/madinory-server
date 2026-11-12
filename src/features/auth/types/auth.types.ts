import type { SupabaseClient, User } from "@supabase/supabase-js";

export type AuthContext = {
  user: User & { aal?: string };
  accessToken: string;
  client: SupabaseClient;
};

export type MeResponse = {
  id: string;
  email?: string;
  role: string;
  aal: "aal1" | "aal2";
  hospitalStaff: boolean;
  profile: {
    userCode: string | null;
    fullName: string | null;
    phoneE164: string | null;
    isPublic: boolean;
    avatarPath: string | null;
  } | null;
  onboardingComplete: boolean;
};

export type ProfileUpdate = {
  full_name?: string;
  phone_e164?: string | null;
  is_public?: boolean;
};
