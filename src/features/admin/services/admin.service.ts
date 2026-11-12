import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../../../config.js";
import type { DoctorVerificationInput, HospitalStaffInput, RoleInput } from "../types/admin.types.js";

function createAdminClient(config: AppConfig): SupabaseClient {
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Admin services are not configured");
  }
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

async function writeAudit(
  client: SupabaseClient,
  actorId: string,
  actorRole: string,
  action: string,
  targetType: string,
  targetId: string,
  meta: Record<string, unknown> = {}
): Promise<void> {
  const { error } = await client.from("audit_logs").insert({
    actor_id: actorId,
    actor_role: actorRole,
    action,
    target_type: targetType,
    target_id: targetId,
    meta
  });
  if (error) throw error;
}

export async function updateUserRole(
  config: AppConfig,
  actorId: string,
  input: RoleInput,
  targetId: string
): Promise<void> {
  const client = createAdminClient(config);
  const { data: existing, error: existingError } = await client.auth.admin.getUserById(targetId);
  if (existingError || !existing.user) throw existingError ?? new Error("Target user not found");
  const { error } = await client.auth.admin.updateUserById(targetId, {
    app_metadata: { ...existing.user.app_metadata, role: input.role }
  });
  if (error) throw error;
  await writeAudit(client, actorId, "admin", "user.role_updated", "user", targetId, { role: input.role });
}

export async function verifyDoctor(
  config: AppConfig,
  actorId: string,
  doctorId: string,
  input: DoctorVerificationInput
): Promise<void> {
  const client = createAdminClient(config);
  const { error } = await client.from("doctors").upsert({
    id: doctorId,
    ...input,
    verification_status: "verified",
    verified_at: new Date().toISOString(),
    verified_by: actorId
  });
  if (error) throw error;
  const { error: roleError } = await client.auth.admin.updateUserById(doctorId, {
    app_metadata: { role: "doctor" }
  });
  if (roleError) throw roleError;
  await writeAudit(client, actorId, "admin", "doctor.verified", "doctor", doctorId, {
    kyc_provider: "manual",
    kyc_status: "pending_provider_integration"
  });
}

export async function assignHospitalStaff(
  config: AppConfig,
  actorId: string,
  hospitalId: string,
  input: HospitalStaffInput
): Promise<void> {
  const client = createAdminClient(config);
  const { error } = await client.from("hospital_staff").upsert({
    hospital_id: hospitalId,
    user_id: input.user_id,
    staff_role: input.staff_role,
    is_active: true
  });
  if (error) throw error;
  await writeAudit(client, actorId, "admin", "hospital.staff_assigned", "hospital", hospitalId, {
    user_id: input.user_id,
    staff_role: input.staff_role
  });
}

export async function createMfaRecoveryReview(
  config: AppConfig,
  actorId: string,
  userId: string,
  reason: string
): Promise<void> {
  const client = createAdminClient(config);
  await writeAudit(client, actorId, "admin", "mfa.recovery_review_requested", "user", userId, {
    reason,
    status: "pending_support_verification"
  });
}
