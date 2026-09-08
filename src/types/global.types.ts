export type user_role = "doctor" | "patient" | "admin";
export type gender_type = "male" | "female" | "other";
export type blood_group_type =
  | "A+"
  | "A-"
  | "B+"
  | "B-"
  | "O+"
  | "O-"
  | "AB+"
  | "AB-";
export type appointment_status =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show";
export type consultation_type = "in_person" | "video_call";
export type payment_status = "pending" | "paid" | "refunded";
export type emergency_status =
  | "triggered"
  | "ambulance_dispatched"
  | "resolved"
  | "cancelled";
export type document_type =
  | "prescription"
  | "lab_report"
  | "scan"
  | "discharge_summary";
export type activity_action =
  | "login"
  | "view_record"
  | "update_profile"
  | "share_record"
  | "doctor_upload"
  | "prediction_run"
  | "logout"
  | "signup"
  | "appointment_booked"
  | "appointment_cancelled"
  | "sos_triggered";
export type access_level = "view_only" | "view_and_download";
export type relation_type =
  | "father"
  | "mother"
  | "sibling"
  | "grandparent"
  | "child"
  | "spouse"
  | "other";
export type doctor_verdict = "correct" | "partially_correct" | "incorrect";
export type vital_type =
  | "blood_pressure"
  | "blood_sugar"
  | "hba1c"
  | "cholesterol"
  | "weight"
  | "bmi";
export type vital_source = "self_reported" | "lab_report" | "doctor_entry";
