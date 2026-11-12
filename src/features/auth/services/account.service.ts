import type { AppConfig } from "../../../config.js";
import { ServiceError } from "../../../errors/service-error.js";
import type { AuthContext } from "../types/auth.types.js";

export async function updatePassword(context: AuthContext, password: string): Promise<void> {
  const { error } = await context.client.auth.updateUser({ password });
  if (error) throw new ServiceError(400, "password_update_failed", "Your password could not be updated.");
}

export async function getSessionInfo(context: AuthContext): Promise<{
  userId: string;
  aal: "aal1" | "aal2";
  email?: string;
}> {
  return {
    userId: context.user.id,
    aal: context.user.aal === "aal2" ? "aal2" : "aal1",
    email: context.user.email,
  };
}

export async function revokeAllSessions(context: AuthContext): Promise<void> {
  const { error } = await context.client.auth.signOut({ scope: "global" });
  if (error) throw new ServiceError(503, "session_update_failed", "Your sessions could not be updated.");
}

export async function createProfileAvatarUpload(
  context: AuthContext,
  config: AppConfig,
  contentType: string,
): Promise<{ bucket: string; path: string; token: string; signedUrl: string }> {
  const bucket = config.SUPABASE_PROFILE_BUCKET;
  if (!bucket) {
    throw new ServiceError(503, "storage_unavailable", "Profile image storage is not configured.");
  }
  const extension = contentType.split("/")[1]?.toLowerCase();
  if (!extension || !["jpeg", "jpg", "png", "webp"].includes(extension)) {
    throw new ServiceError(422, "invalid_profile_image", "Use a JPEG, PNG, or WebP image.");
  }
  const path = `${context.user.id}/avatar-${Date.now()}.${extension}`;
  const { data, error } = await context.client.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data) {
    throw new ServiceError(503, "storage_unavailable", "Profile image storage is temporarily unavailable.");
  }
  return { bucket, path, token: data.token, signedUrl: data.signedUrl };
}

export async function setProfileAvatar(context: AuthContext, path: string): Promise<void> {
  if (!path.startsWith(`${context.user.id}/`) || path.includes("..")) {
    throw new ServiceError(422, "invalid_profile_image", "That profile image is not valid.");
  }
  const { error } = await context.client
    .from("profiles")
    .update({ avatar_path: path })
    .eq("id", context.user.id);
  if (error) throw new ServiceError(503, "profile_unavailable", "Your profile is temporarily unavailable.");
}
