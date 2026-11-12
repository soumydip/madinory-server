import { body, param } from "express-validator";

export const userIdValidator = [
  param("id").isUUID(),
];

export const hospitalIdValidator = [
  param("hospitalId").isUUID(),
];

export const recoveryReviewValidator = [
  ...userIdValidator,
  body("reason").isString().trim().isLength({ min: 20, max: 1000 }),
];

export const roleValidator = [
  ...userIdValidator,
  body("role").isIn(["patient", "doctor", "admin"]),
];

export const doctorVerificationValidator = [
  ...userIdValidator,
  body("specialty").isString().trim().isLength({ min: 1, max: 120 }),
  body("experience_years").optional({ nullable: true }).isInt({ min: 0, max: 70 }),
  body("fee_minor").optional().isInt({ min: 0 }),
  body("fee_currency").optional().isString().isUppercase().isLength({ min: 3, max: 3 }),
  body("timezone").optional().isString().trim().isLength({ min: 1, max: 80 }),
  body("nmc_number").optional({ nullable: true }).isString().trim().isLength({ max: 80 }),
  body("bio").optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
];

export const hospitalStaffValidator = [
  ...hospitalIdValidator,
  body("user_id").isUUID(),
  body("staff_role").isIn(["hospital_admin", "receptionist"]),
];
