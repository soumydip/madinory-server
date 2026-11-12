import type { AuthContext } from "../types/auth.types.js";
import type { HospitalRegistrationApplicationInput } from "../types/hospital-application.types.js";

export async function createHospitalRegistrationApplication(
  context: AuthContext,
  input: HospitalRegistrationApplicationInput,
): Promise<{ id: string; status: "pending" }> {
  const { data, error } = await context.client
    .from("hospital_registration_applications")
    .insert({
      applicant_user_id: context.user.id,
      ...input,
      registration_number: input.registration_number || null,
    })
    .select("id, status")
    .single();

  if (error) throw error;
  return { id: data.id, status: data.status };
}

export function hospitalApplicationError(error: unknown): {
  status: number;
  code: string;
  message: string;
} {
  const databaseError = error as { code?: string };
  if (databaseError.code === "23505") {
    return {
      status: 409,
      code: "application_pending",
      message: "You already have a hospital application under review.",
    };
  }
  return {
    status: 503,
    code: "application_unavailable",
    message: "Hospital registration is temporarily unavailable.",
  };
}
