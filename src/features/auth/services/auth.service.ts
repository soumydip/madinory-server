import type {
  AuthContext,
  MeResponse,
  ProfileUpdate,
} from "../types/auth.types.js";
import { ServiceError } from "../../../errors/service-error.js";

export async function getCurrentUser(
  context: AuthContext,
): Promise<MeResponse> {
  const { data: profile, error } = await context.client
    .from("profiles")
    .select("user_code, full_name, phone_e164, is_public, avatar_path")
    .eq("id", context.user.id)
    .maybeSingle();

  if (error)
    throw new ServiceError(
      503,
      "profile_unavailable",
      "Your profile is temporarily unavailable.",
    );
  const { data: hospitalStaff, error: staffError } = await context.client
    .from("hospital_staff")
    .select("hospital_id")
    .eq("user_id", context.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (staffError)
    throw new ServiceError(
      503,
      "profile_unavailable",
      "Your profile is temporarily unavailable.",
    );
  return {
    id: context.user.id,
    email: context.user.email,
    role: context.user.app_metadata?.role ?? "patient",
    aal: context.user.aal === "aal2" ? "aal2" : "aal1",
    hospitalStaff: Boolean(hospitalStaff),
    profile: profile
      ? {
          userCode: profile.user_code,
          fullName: profile.full_name,
          phoneE164: profile.phone_e164,
          isPublic: profile.is_public,
          avatarPath: profile.avatar_path,
        }
      : null,
    onboardingComplete: Boolean(profile?.full_name),
  };
}

export async function updateCurrentUser(
  context: AuthContext,
  update: ProfileUpdate,
): Promise<void> {
  const { error } = await context.client
    .from("profiles")
    .update(update)
    .eq("id", context.user.id);

  if (error)
    throw new ServiceError(
      503,
      "profile_unavailable",
      "Your profile is temporarily unavailable.",
    );
}

export function profileError(error: unknown): {
  status: number;
  code: string;
  message: string;
} {
  if (error instanceof ServiceError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  const databaseError = error as { code?: string; message?: string };
  if (databaseError.code === "23514") {
    return {
      status: 422,
      code: "invalid_profile",
      message: "Please check your profile details.",
    };
  }
  return {
    status: 503,
    code: "profile_unavailable",
    message: "Your profile is temporarily unavailable.",
  };
}
