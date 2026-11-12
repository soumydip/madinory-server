import { Router } from "express";
import type { AppConfig } from "../../../config.js";
import { authenticate, requireAal2, requireRole } from "../../../middleware/auth.js";
import { validate } from "../../../middleware/validate.js";
import {
  doctorVerificationValidator,
  hospitalStaffValidator,
  recoveryReviewValidator,
  roleValidator,
} from "../validators/admin.validators.js";
import {
  assignStaffController,
  createMfaRecoveryReviewController,
  updateRoleController,
  verifyDoctorController
} from "../controllers/admin.controller.js";

export function createAdminRouter(config: AppConfig): Router {
  const router = Router();
  const guard = [authenticate(config), requireRole("admin"), requireAal2];
  router.post(
    "/users/:id/mfa/recovery-review",
    ...guard,
    ...recoveryReviewValidator,
    validate,
    (req, res) => createMfaRecoveryReviewController(config, req, res)
  );
  router.post(
    "/users/:id/role",
    ...guard,
    ...roleValidator,
    validate,
    (req, res) => updateRoleController(config, req, res)
  );
  router.post(
    "/doctors/:id/verify",
    ...guard,
    ...doctorVerificationValidator,
    validate,
    (req, res) => verifyDoctorController(config, req, res)
  );
  router.post(
    "/hospitals/:hospitalId/staff",
    ...guard,
    ...hospitalStaffValidator,
    validate,
    (req, res) => assignStaffController(config, req, res)
  );
  return router;
}
