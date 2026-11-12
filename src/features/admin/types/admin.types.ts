export type DoctorVerificationInput = {
  specialty: string;
  experience_years?: number | null;
  fee_minor?: number;
  fee_currency?: string;
  timezone?: string;
  nmc_number?: string | null;
  bio?: string | null;
};

export type HospitalStaffInput = {
  user_id: string;
  staff_role: "hospital_admin" | "receptionist";
};

export type RoleInput = {
  role: "patient" | "doctor" | "admin";
};
