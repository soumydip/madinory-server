import type { SupabaseClient, User } from "@supabase/supabase-js";

export type AuthenticatedUser = User & { aal?: string };

declare global {
  namespace Express {
    interface Request {
      user?: User;
      auth?: {
        user: AuthenticatedUser;
        accessToken: string;
        client: SupabaseClient;
      };
    }
  }
}

export {};
