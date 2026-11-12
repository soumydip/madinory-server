import type { Request, Response } from "express";
import type { AppConfig } from "../../../config.js";
import { sendError, sendSuccess } from "../../../http/response.js";
import { assignHospitalStaff, createMfaRecoveryReview, updateUserRole, verifyDoctor } from "../services/admin.service.js";

function requireActor(req: Request, res: Response): string | null {
  if (!req.auth) {
    sendError(res, 401, "unauthenticated", "Authentication is required.");
    return null;
  }
  return req.auth.user.id;
}

function handleAdminError(res: Response): void {
  sendError(res, 503, "admin_unavailable", "This administrative action is temporarily unavailable.");
}

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

export async function updateRoleController(config: AppConfig, req: Request, res: Response): Promise<void> {
  const actorId = requireActor(req, res);
  if (!actorId) return;
  try {
    await updateUserRole(config, actorId, req.body, routeParam(req.params.id));
    sendSuccess(res, undefined, "User role updated.");
  } catch {
    handleAdminError(res);
  }
}

export async function verifyDoctorController(config: AppConfig, req: Request, res: Response): Promise<void> {
  const actorId = requireActor(req, res);
  if (!actorId) return;
  try {
    await verifyDoctor(config, actorId, routeParam(req.params.id), req.body);
    sendSuccess(res, undefined, "Doctor verified.");
  } catch {
    handleAdminError(res);
  }
}

export async function assignStaffController(config: AppConfig, req: Request, res: Response): Promise<void> {
  const actorId = requireActor(req, res);
  if (!actorId) return;
  try {
    await assignHospitalStaff(config, actorId, routeParam(req.params.hospitalId), req.body);
    sendSuccess(res, undefined, "Hospital staff assigned.");
  } catch {
    handleAdminError(res);
  }
}

export async function createMfaRecoveryReviewController(config: AppConfig, req: Request, res: Response): Promise<void> {
  const actorId = requireActor(req, res);
  if (!actorId) return;
  try {
    await createMfaRecoveryReview(config, actorId, routeParam(req.params.id), req.body.reason);
    sendSuccess(res, { status: "pending_support_verification" }, "Recovery review requested.", 202);
  } catch {
    handleAdminError(res);
  }
}
