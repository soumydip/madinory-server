# Medinory / MediVault AI — Full Database Schema

**Stack:** Supabase (PostgreSQL) for all relational/transactional data · Neo4j for the symptom-disease graph · Cloudinary for file storage (Postgres holds only the reference URL) · Redis for cache, session, and real-time SOS tracking (not a system of record).

---

## 1. `users` — Core identity (all roles)

| Field Name | Type         | Key Type                | Description                                                           |
| ---------- | ------------ | ----------------------- | --------------------------------------------------------------------- |
| UUID       | varchar(36)  | primary key, not null   | user unique identifier in DB                                          |
| name       | varchar(50)  | not null                | user name                                                             |
| email      | varchar(50)  | unique, not null        | user email                                                            |
| MDID       | varchar(50)  | unique, not null        | medinory ID (patient: MD-unique_id, doctor: MDD-unique_id)            |
| password   | varchar(100) | null                    | hashed password (bcrypt/argon2) — null if user signed up via OAuth    |
| createdAt  | timestamp    | not null                | user created time                                                     |
| updatedAt  | timestamp    | not null                | user updated time                                                     |
| isActive   | boolean      | not null, default true  | user is active or not                                                 |
| isBlocked  | boolean      | not null, default false | user is blocked or not                                                |
| blockData  | JSON         | null                    | block reason, blockedAt, blockedUntil                                 |
| role       | ENUM         | not null                | doctor, patient, admin                                                |
| profilePic | varchar(255) | null                    | profile picture URL (Cloudinary)                                      |
| gender     | ENUM         | null                    | male, female, other                                                   |
| dob        | date         | null                    | date of birth _(encrypted)_                                           |
| address    | varchar(255) | null                    | user address _(encrypted)_                                            |
| phone      | varchar(15)  | unique, null, indexed   | phone number _(encrypted)_                                            |
| isVerified | boolean      | not null, default false | email/phone verified or not                                           |
| OAuth      | JSON         | null                    | OAuth provider data (google, facebook, apple) — provider + providerId |
| isDeleted  | boolean      | not null, default false | soft delete flag                                                      |
| deletedAt  | timestamp    | null                    | soft delete time                                                      |

---

## 2. `patient_profiles`

| Field Name            | Type         | Key Type                          | Description                                                  |
| --------------------- | ------------ | --------------------------------- | ------------------------------------------------------------ |
| id                    | varchar(36)  | primary key, not null             | profile row id                                               |
| userUUID              | varchar(36)  | FK -> users.UUID, unique, not null | 1:1 link to core user                                        |
| bloodGroup            | ENUM         | null                              | A+, A-, B+, B-, O+, O-, AB+, AB-                             |
| abhaId                | varchar(50)  | unique, null                      | India ABDM health ID                                         |
| emergencyContactName  | varchar(50)  | null                              | name of emergency contact                                    |
| emergencyContactPhone | varchar(15)  | null                              | phone of emergency contact _(encrypted)_                     |
| height_cm             | int          | null                              | for BMI calculation                                          |
| weight_kg             | decimal(5,2) | null                              | latest recorded weight                                       |
| chronicConditions     | JSON         | null                              | array of known chronic conditions                            |
| allergies             | JSON         | null                              | array of known allergies                                     |
| familyHistoryRef      | JSON         | null                              | quick-reference flags (full history lives in `family_links`) |
| createdAt             | timestamp    | not null                          | row created time                                             |
| updatedAt             | timestamp    | not null                          | row updated time                                             |

---

## 3. `doctor_profiles`

| Field Name         | Type         | Key Type                          | Description                                            |
| ------------------ | ------------ | --------------------------------- | ------------------------------------------------------ |
| id                 | varchar(36)  | primary key, not null             | profile row id                                         |
| userUUID           | varchar(36)  | FK -> users.UUID, unique, not null | 1:1 link to core user                                  |
| specialization     | varchar(100) | not null                          | e.g. Cardiologist, General Physician                   |
| licenseNumber      | varchar(50)  | unique, not null                  | medical council registration number                    |
| licenseVerified    | boolean      | not null, default false           | admin-verified or not                                  |
| licenseDocUrl      | varchar(255) | null                              | uploaded license/certificate (Cloudinary)              |
| yearsOfExperience  | int          | null                              | years practicing                                       |
| consultationFee    | decimal(8,2) | null                              | fee per consultation                                   |
| clinicHospitalName | varchar(150) | null                              | primary practice location                              |
| rating             | decimal(3,2) | null                              | average patient rating (derived from `doctor_reviews`) |
| bio                | varchar(500) | null                              | short professional bio                                 |
| createdAt          | timestamp    | not null                          | row created time                                       |
| updatedAt          | timestamp    | not null                          | row updated time                                       |

---

## 4. `appointments`

| Field Name       | Type         | Key Type                  | Description                                       |
| ---------------- | ------------ | ------------------------- | ------------------------------------------------- |
| id               | varchar(36)  | primary key, not null     | appointment ID                                    |
| patientUUID      | varchar(36)  | FK -> users.UUID, not null | which patient                                     |
| doctorUUID       | varchar(36)  | FK -> users.UUID, not null | which doctor                                      |
| scheduledAt      | timestamp    | not null                  | appointment time                                  |
| status           | ENUM         | not null                  | pending, confirmed, completed, cancelled, no_show |
| consultationType | ENUM         | not null                  | in_person, video_call                             |
| fee              | decimal(8,2) | null                      | amount charged                                    |
| paymentStatus    | ENUM         | not null                  | pending, paid, refunded                           |
| notes            | varchar(500) | null                      | patient's note/reason for visit                   |
| createdAt        | timestamp    | not null                  | booking time                                      |
| updatedAt        | timestamp    | not null                  | last update                                       |

---

## 5. `emergency_records` (SOS)

| Field Name          | Type        | Key Type                  | Description                                                              |
| ------------------- | ----------- | ------------------------- | ------------------------------------------------------------------------ |
| id                  | varchar(36) | primary key, not null     | emergency event ID                                                       |
| patientUUID         | varchar(36) | FK -> users.UUID, not null | who triggered SOS                                                        |
| triggeredAt         | timestamp   | not null                  | when                                                                     |
| location            | JSON        | null                      | lat/lng _(encrypted)_                                                    |
| status              | ENUM        | not null                  | triggered, ambulance_dispatched, resolved, cancelled                     |
| responseTimeSeconds | int         | null                      | how fast it was picked up (matches the "5s delay/track" in your diagram) |
| notifiedContacts    | JSON        | null                      | who was notified                                                         |

---

## 6. `documents` (file references — actual files live in Cloudinary)

| Field Name           | Type         | Key Type                   | Description                                       |
| -------------------- | ------------ | -------------------------- | ------------------------------------------------- |
| id                   | varchar(36)  | primary key, not null      | document ID                                       |
| ownerUUID            | varchar(36)  | FK -> users.UUID, not null  | whose document                                    |
| uploadedByUUID       | varchar(36)  | FK -> users.UUID, not null  | who uploaded it (self or doctor)                  |
| type                 | ENUM         | not null                   | prescription, lab_report, scan, discharge_summary |
| fileUrl              | varchar(255) | not null                   | Cloudinary URL                                    |
| isEncrypted          | boolean      | not null, default true     | encryption status                                 |
| relatedAppointmentId | varchar(36)  | FK -> appointments.id, null | which visit this document belongs to              |
| uploadedAt           | timestamp    | not null                   | when uploaded                                     |

---

## 7. `activity_logs` (audit trail)

| Field Name   | Type        | Key Type                  | Description                                                                        |
| ------------ | ----------- | ------------------------- | ---------------------------------------------------------------------------------- |
| id           | varchar(36) | primary key, not null     | log entry ID                                                                       |
| userUUID     | varchar(36) | FK -> users.UUID, not null | who performed the action                                                           |
| targetUUID   | varchar(36) | FK -> users.UUID, null     | whose data was affected (null for self-actions)                                    |
| action       | ENUM        | not null                  | login, view_record, update_profile, share_record, doctor_upload, prediction_run... |
| resourceType | varchar(50) | null                      | "prescription", "lab_report", "prediction_result"...                               |
| resourceId   | varchar(36) | null                      | ID of the specific resource                                                        |
| ipAddress    | varchar(45) | null                      | _(encrypted)_                                                                      |
| metadata     | JSON        | null                      | device, location, extra context                                                    |
| createdAt    | timestamp   | not null                  | when it happened                                                                   |

---

## 8. `consent_shares` (record-sharing permissions)

| Field Name     | Type        | Key Type                  | Description                                    |
| -------------- | ----------- | ------------------------- | ---------------------------------------------- |
| id             | varchar(36) | primary key, not null     | share record ID                                |
| ownerUUID      | varchar(36) | FK -> users.UUID, not null | whose record                                   |
| sharedWithUUID | varchar(36) | FK -> users.UUID, not null | who it's shared with                           |
| documentId     | varchar(36) | FK -> documents.id, null   | specific document (null = full profile access) |
| accessLevel    | ENUM        | not null                  | view_only, view_and_download                   |
| expiresAt      | timestamp   | null                      | when access ends (null = no expiry)            |
| revokedAt      | timestamp   | null                      | when manually revoked                          |
| createdAt      | timestamp   | not null                  | when shared                                    |

---


### 9. `family_links` (structured family history — supports the "family disease history" feature)

| Field Name         | Type         | Key Type                  | Description                                                  |
| ------------------ | ------------ | ------------------------- | ------------------------------------------------------------ |
| id                 | varchar(36)  | primary key, not null     | link ID                                                      |
| patientUUID        | varchar(36)  | FK -> users.UUID, not null | the patient this history belongs to                          |
| relatedPatientUUID | varchar(36)  | FK -> users.UUID, null     | linked family member's own account, if they're also a user   |
| relationType       | ENUM         | not null                  | father, mother, sibling, grandparent, child...               |
| condition          | varchar(100) | not null                  | e.g. "Type 2 Diabetes", "Brain Tumor"                        |
| diagnosedAge       | int          | null                      | family member's age at diagnosis (relevant for risk scoring) |
| notes              | varchar(255) | null                      | free-text context                                            |
| createdAt          | timestamp    | not null                  | row created time                                             |


### 10. `prediction_logs` (every prediction run — needed for the doctor-feedback accuracy loop)

| Field Name         | Type        | Key Type                  | Description                                       |
| ------------------ | ----------- | ------------------------- | ------------------------------------------------- |
| id                 | varchar(36) | primary key, not null     | prediction run ID                                 |
| patientUUID        | varchar(36) | FK -> users.UUID, not null | who ran it                                        |
| inputSymptoms      | JSON        | not null                  | symptom IDs submitted                             |
| contextSnapshot    | JSON        | null                      | age/gender/family-history used at run time        |
| results            | JSON        | not null                  | ranked disease scores returned                    |
| redFlagTriggered   | boolean     | not null, default false   | whether an emergency flag fired                   |
| doctorReviewedUUID | varchar(36) | FK -> users.UUID, null     | doctor who later confirmed/corrected this, if any |
| doctorVerdict      | ENUM        | null                      | correct, partially_correct, incorrect             |
| createdAt          | timestamp   | not null                  | when the prediction ran                           |

_This is the table your ML/data team will query to measure real-world accuracy and re-tune weights — without it, the "doctor feedback loop" you wanted has nowhere to write to._

### 11. `doctor_slots`

| Field Name    | Type        | Key Type                   | Description                |
| ------------- | ----------- | -------------------------- | -------------------------- |
| id            | varchar(36) | primary key, not null      | slot ID                    |
| doctorUUID    | varchar(36) | FK -> users.UUID, not null  | which doctor               |
| slotStart     | timestamp   | not null                   | slot start time            |
| slotEnd       | timestamp   | not null                   | slot end time              |
| isBooked      | boolean     | not null, default false    | availability flag          |
| appointmentId | varchar(36) | FK -> appointments.id, null | linked booking, once taken |

### 12. `doctor_reviews`

| Field Name    | Type         | Key Type                               | Description                          |
| ------------- | ------------ | -------------------------------------- | ------------------------------------ |
| id            | varchar(36)  | primary key, not null                  | review ID                            |
| appointmentId | varchar(36)  | FK -> appointments.id, unique, not null | one review per completed appointment |
| patientUUID   | varchar(36)  | FK -> users.UUID, not null              | who left the review                  |
| doctorUUID    | varchar(36)  | FK -> users.UUID, not null              | who's being reviewed                 |
| rating        | int          | not null                               | 1–5                                  |
| comment       | varchar(500) | null                                   | free-text feedback                   |
| createdAt     | timestamp    | not null                               | when submitted                       |

### 13. `notification_preferences`

| Field Name           | Type        | Key Type                          | Description             |
| -------------------- | ----------- | --------------------------------- | ----------------------- |
| id                   | varchar(36) | primary key, not null             | row ID                  |
| userUUID             | varchar(36) | FK -> users.UUID, unique, not null | which user              |
| smsEnabled           | boolean     | not null, default true            | SMS channel on/off      |
| emailEnabled         | boolean     | not null, default true            | email channel on/off    |
| pushEnabled          | boolean     | not null, default true            | push channel on/off     |
| medicineReminders    | boolean     | not null, default true            | dose reminder toggle    |
| appointmentReminders | boolean     | not null, default true            | booking reminder toggle |

### 14. `medicine_reminders`

| Field Name   | Type         | Key Type                  | Description                    |
| ------------ | ------------ | ------------------------- | ------------------------------ |
| id           | varchar(36)  | primary key, not null     | reminder ID                    |
| patientUUID  | varchar(36)  | FK -> users.UUID, not null | which patient                  |
| documentId   | varchar(36)  | FK -> documents.id, null   | source prescription, if linked |
| medicineName | varchar(100) | not null                  | drug name                      |
| dosage       | varchar(50)  | null                      | e.g. "500mg"                   |
| frequency    | varchar(50)  | not null                  | e.g. "twice daily"             |
| startDate    | date         | not null                  | when to start                  |
| endDate      | date         | null                      | when to stop (null = ongoing)  |
| isActive     | boolean      | not null, default true    | still active reminder or not   |

### 15. `health_vitals` (time-series — powers the trend graphs feature)

| Field Name  | Type        | Key Type                  | Description                                                  |
| ----------- | ----------- | ------------------------- | ------------------------------------------------------------ |
| id          | varchar(36) | primary key, not null     | reading ID                                                   |
| patientUUID | varchar(36) | FK -> users.UUID, not null | which patient                                                |
| type        | ENUM        | not null                  | blood_pressure, blood_sugar, hba1c, cholesterol, weight, bmi |
| value       | JSON        | not null                  | e.g. `{"systolic":120,"diastolic":80}` or `{"value":98}`     |
| recordedAt  | timestamp   | not null                  | when measured                                                |
| source      | ENUM        | not null                  | self_reported, lab_report, doctor_entry                      |

_Best as a proper time-series-friendly table (indexed on `patientUUID, type, recordedAt`) rather than JSON blobs on the profile, since this is exactly what the "Health Stability Index" gauge and trend graphs will query most often._

### 16. `sessions` (optional — only if you want refresh tokens tracked in Postgres rather than purely in Redis)

| Field Name       | Type         | Key Type                  | Description                           |
| ---------------- | ------------ | ------------------------- | ------------------------------------- |
| id               | varchar(36)  | primary key, not null     | session ID                            |
| userUUID         | varchar(36)  | FK -> users.UUID, not null | which user                            |
| refreshTokenHash | varchar(255) | not null                  | hashed refresh token, never store raw |
| deviceInfo       | JSON         | null                      | device/browser fingerprint            |
| expiresAt        | timestamp    | not null                  | expiry                                |
| revokedAt        | timestamp    | null                      | manual logout/revoke time             |
| createdAt        | timestamp    | not null                  | login time                            |

---

## Relationship Summary

```
users (1) - (0..1) patient_profiles      [role = 'patient']
users (1) - (0..1) doctor_profiles       [role = 'doctor']
users (1) - (many) appointments          [as patient or doctor]
users (1) - (many) documents             [as owner or uploader]
users (1) - (many) emergency_records
users (1) - (many) activity_logs
users (1) - (many) consent_shares        [as owner or recipient]
users (1) - (many) family_links
users (1) - (many) prediction_logs
users (1) - (many) health_vitals
users (1) - (many) medicine_reminders
users (1) -  (1)   notification_preferences

doctor_profiles (1) - (many) doctor_slots
doctor_profiles (1) - (many) doctor_reviews
appointments (1) -  (0..1) doctor_reviews
appointments (1) - (many) documents
```

**Enforced at the application layer, not by FK constraints alone:**

- `patient_profiles` row only exists if `users.role = 'patient'` (same for doctor)
- Exactly one of `users.password` / `users.OAuth` non-null at signup
- `emergency_records.location` and other PII fields are encrypted before insert, decrypted only on authenticated read

---

## Where Neo4j fits (outside this list)

Everything above is Supabase/PostgreSQL. Neo4j holds only the **symptom -> disease graph** (nodes, edges, weights, hard/context rules) used by the Go prediction engine — it has no user data and isn't part of this relational schema.
