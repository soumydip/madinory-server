import type { Request, Response } from "express";
import type { AppConfig } from "../../../config.js";
import {
  getCurrentUser,
  profileError,
  updateCurrentUser,
} from "../services/auth.service.js";
import {
  clearAuthSession,
  refreshSession,
} from "../services/session.service.js";
import {
  beginGoogleOAuth,
  finishGoogleOAuth,
  getOAuthFailureRedirect,
} from "../services/oauth.service.js";
import {
  createHospitalRegistrationApplication,
  hospitalApplicationError,
} from "../services/hospital-application.service.js";
import {
  loginWithPassword,
  registerWithPassword,
} from "../services/password.service.js";
import {
  createProfileAvatarUpload,
  getSessionInfo,
  revokeAllSessions,
  updatePassword,
  setProfileAvatar,
} from "../services/account.service.js";
import { sendError, sendSuccess } from "../../../http/response.js";
import { ServiceError } from "../../../errors/service-error.js";

function failure(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
) {
  if (error instanceof ServiceError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      fields: error.fields,
    };
  }
  return { status: 503, code: fallbackCode, message: fallbackMessage };
}

export async function getMeController(
  req: Request,
  res: Response,
): Promise<void> {
  if (!req.auth) {
    sendError(res, 401, "unauthenticated", "Authentication is required.");
    return;
  }
  try {
    sendSuccess(res, await getCurrentUser(req.auth));
  } catch {
    sendError(
      res,
      503,
      "profile_unavailable",
      "Your profile is temporarily unavailable.",
    );
  }
}

export async function updateMeController(
  req: Request,
  res: Response,
): Promise<void> {
  if (!req.auth) {
    sendError(res, 401, "unauthenticated", "Authentication is required.");
    return;
  }

  try {
    await updateCurrentUser(req.auth, req.body);
    sendSuccess(res, await getCurrentUser(req.auth), "Profile updated.");
  } catch (error) {
    const mapped = profileError(error);
    sendError(res, mapped.status, mapped.code, mapped.message);
  }
}

export async function hospitalRegistrationController(
  req: Request,
  res: Response,
): Promise<void> {
  if (!req.auth) {
    sendError(res, 401, "unauthenticated", "Authentication is required.");
    return;
  }
  try {
    const application = await createHospitalRegistrationApplication(
      req.auth,
      req.body,
    );
    sendSuccess(res, application, "Hospital application submitted.", 202);
  } catch (error) {
    const mapped = hospitalApplicationError(error);
    sendError(res, mapped.status, mapped.code, mapped.message);
  }
}

export async function registerController(
  config: AppConfig,
  req: Request,
  res: Response,
): Promise<void> {
  const { fullName, email, password } = req.body;
  try {
    const data = await registerWithPassword(
      config,
      res,
      email,
      password,
      fullName,
    );
    sendSuccess(res, data, "Account created.", 201);
  } catch (error) {
    const mapped = failure(
      error,
      "registration_failed",
      "We could not create that account.",
    );
    sendError(res, mapped.status, mapped.code, mapped.message, mapped.fields);
  }
}

export async function loginController(
  config: AppConfig,
  req: Request,
  res: Response,
): Promise<void> {
  try {
    sendSuccess(
      res,
      await loginWithPassword(config, res, req.body.email, req.body.password),
    );
  } catch (error) {
    const mapped = failure(
      error,
      "invalid_credentials",
      "Email or password is incorrect.",
    );
    sendError(res, mapped.status, mapped.code, mapped.message, mapped.fields);
  }
}

export async function refreshController(
  config: AppConfig,
  req: Request,
  res: Response,
): Promise<void> {
  const refreshToken = req.cookies?.medinory_refresh;
  if (!refreshToken) {
    clearAuthSession(res, config);
    sendError(res, 401, "unauthenticated", "Authentication is required.");
    return;
  }
  try {
    await refreshSession(config, res, refreshToken);
    sendSuccess(res, undefined, "Session refreshed.");
  } catch {
    clearAuthSession(res, config);
    sendError(res, 401, "unauthenticated", "Authentication is required.");
  }
}

export function logoutController(
  config: AppConfig,
  _req: Request,
  res: Response,
): void {
  clearAuthSession(res, config);
  sendSuccess(res, undefined, "Signed out.");
}

export async function updatePasswordController(
  req: Request,
  res: Response,
): Promise<void> {
  if (!req.auth) {
    sendError(res, 401, "unauthenticated", "Authentication is required.");
    return;
  }
  try {
    await updatePassword(req.auth, req.body.password);
    sendSuccess(res, undefined, "Password updated.");
  } catch (error) {
    const mapped = failure(
      error,
      "password_update_failed",
      "Your password could not be updated.",
    );
    sendError(res, mapped.status, mapped.code, mapped.message);
  }
}

export async function getSessionController(
  req: Request,
  res: Response,
): Promise<void> {
  if (!req.auth) {
    sendError(res, 401, "unauthenticated", "Authentication is required.");
    return;
  }
  sendSuccess(res, await getSessionInfo(req.auth));
}

export async function revokeSessionsController(
  req: Request,
  res: Response,
): Promise<void> {
  if (!req.auth) {
    sendError(res, 401, "unauthenticated", "Authentication is required.");
    return;
  }
  try {
    await revokeAllSessions(req.auth);
    sendSuccess(res, undefined, "All sessions have been signed out.");
  } catch (error) {
    const mapped = failure(
      error,
      "session_update_failed",
      "Your sessions could not be updated.",
    );
    sendError(res, mapped.status, mapped.code, mapped.message);
  }
}

export async function createAvatarUploadController(
  config: AppConfig,
  req: Request,
  res: Response,
): Promise<void> {
  if (!req.auth) {
    sendError(res, 401, "unauthenticated", "Authentication is required.");
    return;
  }
  try {
    const data = await createProfileAvatarUpload(
      req.auth,
      config,
      req.body.content_type,
    );
    sendSuccess(res, data, "Profile image upload URL created.");
  } catch (error) {
    const mapped = failure(
      error,
      "storage_unavailable",
      "Profile image storage is temporarily unavailable.",
    );
    sendError(res, mapped.status, mapped.code, mapped.message);
  }
}

export async function setAvatarController(
  req: Request,
  res: Response,
): Promise<void> {
  if (!req.auth) {
    sendError(res, 401, "unauthenticated", "Authentication is required.");
    return;
  }
  try {
    await setProfileAvatar(req.auth, req.body.path);
    sendSuccess(res, await getCurrentUser(req.auth), "Profile image updated.");
  } catch (error) {
    const mapped = failure(
      error,
      "profile_unavailable",
      "Your profile is temporarily unavailable.",
    );
    sendError(res, mapped.status, mapped.code, mapped.message);
  }
}

export function googleStartController(
  config: AppConfig,
  req: Request,
  res: Response,
): void {
  res.redirect(beginGoogleOAuth(config, res, req.query.next));
}

export async function googleCallbackController(
  config: AppConfig,
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const next = await finishGoogleOAuth(
      config,
      res,
      req.cookies?.medinory_oauth,
      req.query.state,
      req.query.code,
    );
    res.redirect(`${config.FRONTEND_URL}${next}`);
  } catch {
    res.redirect(getOAuthFailureRedirect(config));
  }
}
