import { body } from "express-validator";

export const registerValidator = [
  body("email").isEmail().normalizeEmail(),
  body("password").isString().isLength({ min: 8, max: 72 }),
];

export const loginValidator = [
  body("email").isEmail().normalizeEmail(),
  body("password").isString().isLength({ min: 8, max: 72 }),
];

export const profileValidator = [
  body("full_name").optional({ nullable: true }).isString().trim().isLength({ min: 1, max: 120 }),
  body("phone_e164").optional({ nullable: true }).matches(/^\+[1-9][0-9]{7,14}$/),
  body("is_public").optional().isBoolean({ strict: true }),
];

export const passwordValidator = [
  body("password").isString().isLength({ min: 8, max: 72 }),
];

export const avatarUploadValidator = [
  body("content_type").isString().isIn(["image/jpeg", "image/png", "image/webp"]),
];

export const avatarPathValidator = [
  body("path").isString().isLength({ min: 38, max: 180 }),
];

export const hospitalRegistrationValidator = [
  body("hospital_name").isString().trim().isLength({ min: 2, max: 160 }),
  body("registration_number").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
  body("phone_e164").isString().trim().matches(/^\+[1-9][0-9]{7,14}$/),
  body("address").isString().trim().isLength({ min: 5, max: 500 }),
  body("city").isString().trim().isLength({ min: 2, max: 100 }),
  body("state").isString().trim().isLength({ min: 2, max: 100 }),
  body("country_code").optional().isString().trim().isLength({ min: 2, max: 2 }).matches(/^[A-Z]{2}$/),
];

export const mfaFactorValidator = [
  body("factor_id").isUUID(),
];

export const mfaCodeValidator = [
  body("code").isString().trim().matches(/^[0-9]{6}$/),
];

export const mfaEnrollmentValidator = [
  body("factor_id").isUUID(),
  body("code").isString().trim().matches(/^[0-9]{6}$/),
];

export const mfaChallengeValidator = [
  body("factor_id").isUUID(),
  body("challenge_id").isUUID(),
  body("code").isString().trim().matches(/^[0-9]{6}$/),
];

export const mfaRecoveryValidator = [
  body("code").isString().trim().isLength({ min: 12, max: 12 }).matches(/^[A-F0-9]{12}$/),
];
