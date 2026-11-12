import { Router } from "express";
import type { AppConfig } from "../../../config.js";
import { authenticate } from "../../../middleware/auth.js";
import { createRateLimiter } from "../../../middleware/rate-limit.js";
import { validate } from "../../../middleware/validate.js";
import {
  avatarPathValidator,
  avatarUploadValidator,
  hospitalRegistrationValidator,
  loginValidator,
  mfaChallengeValidator,
  mfaCodeValidator,
  mfaFactorValidator,
  mfaEnrollmentValidator,
  mfaRecoveryValidator,
  passwordValidator,
  profileValidator,
  registerValidator,
} from "../validators/auth.validators.js";
import {
  getMeController,
  logoutController,
  refreshController,
  registerController,
  loginController,
  googleCallbackController,
  googleStartController,
  hospitalRegistrationController,
  updateMeController,
  updatePasswordController,
  getSessionController,
  revokeSessionsController,
  createAvatarUploadController,
  setAvatarController
} from "../controllers/auth.controller.js";
import {
  challengeMfaController,
  enrollMfaController,
  recoveryCodeController,
  listMfaController,
  disableMfaController,
  verifyEnrollmentController,
  verifyMfaController
} from "../controllers/mfa.controller.js";

export function createAuthRouter(config: AppConfig): Router {
  const router = Router();
  router.post(
    "/auth/register",
    createRateLimiter(config, "auth:register", 5, 600),
    ...registerValidator,
    validate,
    (req, res) => registerController(config, req, res),
  );
  router.post(
    "/auth/login",
    createRateLimiter(config, "auth:login", 10, 600),
    ...loginValidator,
    validate,
    (req, res) => loginController(config, req, res),
  );
  router.post("/auth/refresh", createRateLimiter(config, "auth:refresh", 20, 60), (req, res) =>
    refreshController(config, req, res)
  );
  router.post("/auth/logout", logoutController.bind(null, config));
  router.get("/auth/google", createRateLimiter(config, "auth:google", 10, 600), (req, res) =>
    googleStartController(config, req, res)
  );
  router.get("/auth/google/callback", googleCallbackController.bind(null, config));
  router.get("/me", authenticate(config), getMeController);
  router.get("/me/profile", authenticate(config), getMeController);
  router.patch(
    "/me",
    authenticate(config),
    ...profileValidator,
    validate,
    updateMeController
  );
  router.patch(
    "/me/profile",
    authenticate(config),
    ...profileValidator,
    validate,
    updateMeController
  );
  router.patch(
    "/me/password",
    authenticate(config),
    ...passwordValidator,
    validate,
    updatePasswordController
  );
  router.get("/me/sessions", authenticate(config), getSessionController);
  router.delete("/me/sessions", authenticate(config), revokeSessionsController);
  router.post(
    "/me/profile/avatar/upload-url",
    authenticate(config),
    ...avatarUploadValidator,
    validate,
    (req, res) => createAvatarUploadController(config, req, res),
  );
  router.patch(
    "/me/profile/avatar",
    authenticate(config),
    ...avatarPathValidator,
    validate,
    setAvatarController,
  );
  router.post(
    "/auth/register/hospital",
    authenticate(config),
    ...hospitalRegistrationValidator,
    validate,
    hospitalRegistrationController
  );
  const mfaGuard = [authenticate(config)];
  router.post("/auth/mfa/enroll", ...mfaGuard, enrollMfaController);
  router.get("/auth/mfa", ...mfaGuard, listMfaController);
  router.delete(
    "/auth/mfa",
    ...mfaGuard,
    ...mfaFactorValidator,
    validate,
    disableMfaController,
  );
  router.post(
    "/auth/mfa/enroll/verify",
    ...mfaGuard,
    ...mfaEnrollmentValidator,
    validate,
    (req, res) => verifyEnrollmentController(config, req, res)
  );
  router.post(
    "/auth/mfa/challenge",
    ...mfaGuard,
    ...mfaFactorValidator,
    validate,
    challengeMfaController
  );
  router.post(
    "/auth/mfa/verify",
    ...mfaGuard,
    ...mfaChallengeValidator,
    validate,
    (req, res) => verifyMfaController(config, req, res)
  );
  router.post(
    "/auth/mfa/recovery",
    ...mfaGuard,
    ...mfaRecoveryValidator,
    validate,
    (req, res) => recoveryCodeController(config, req, res)
  );
  return router;
}
