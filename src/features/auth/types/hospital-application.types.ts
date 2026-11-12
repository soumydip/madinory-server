export type HospitalRegistrationApplicationInput = {
  hospital_name: string;
  registration_number?: string | null;
  phone_e164: string;
  address: string;
  city: string;
  state: string;
  country_code: string;
};
