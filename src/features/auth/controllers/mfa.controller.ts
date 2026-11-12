import type { Request, Response } from "express";
import type { AppConfig } from "../../../config.js";
import { sendError, sendSuccess } from "../../../http/response.js";
import {
  challengeTotp,
  consumeRecoveryCode,
  disableTotp,
  enrollTotp,
  listTotpFactors,
  verifyChallenge,
  verifyTotp,
} from "../services/mfa.service.js";

function context(req: Request, res: Response) {
  if (!req.auth) {
    sendError(res, 401, "unauthenticated", "Authentication is required.");
    return null;
  }
  return req.auth;
}

function failed(res: Response): void {
  sendError(res, 401, "mfa_failed", "Multi-factor authentication failed.");
}

export async function enrollMfaController(req: Request, res: Response): Promise<void> {
  const auth = context(req, res);
  if (!auth) return;
  try {
    sendSuccess(res, await enrollTotp(auth));
  } catch {
    failed(res);
  }
}

export async function listMfaController(req: Request, res: Response): Promise<void> {
  const auth = context(req, res);
  if (!auth) return;
  try {
    sendSuccess(res, { factors: await listTotpFactors(auth) });
  } catch {
    failed(res);
  }
}

export async function disableMfaController(req: Request, res: Response): Promise<void> {
  const auth = context(req, res);
  if (!auth) return;
  try {
    await disableTotp(auth, req.body.factor_id);
    sendSuccess(res, undefined, "Multi-factor authentication disabled.");
  } catch {
    failed(res);
  }
}

export async function verifyEnrollmentController(config: AppConfig, req: Request, res: Response): Promise<void> {
  const auth = context(req, res);
  if (!auth) return;
  try {
    const recoveryCodes = await verifyTotp(auth, res, config, req.body.factor_id, req.body.code);
    sendSuccess(res, { recoveryCodes }, "Multi-factor authentication enabled.");
  } catch {
    failed(res);
  }
}

export async function challengeMfaController(req: Request, res: Response): Promise<void> {
  const auth = context(req, res);
  if (!auth) return;
  try {
    sendSuccess(res, { challengeId: await challengeTotp(auth, req.body.factor_id) });
  } catch {
    failed(res);
  }
}

export async function verifyMfaController(config: AppConfig, req: Request, res: Response): Promise<void> {
  const auth = context(req, res);
  if (!auth) return;
  try {
    await verifyChallenge(auth, res, config, req.body.factor_id, req.body.challenge_id, req.body.code);
    sendSuccess(res, undefined, "Multi-factor authentication verified.");
  } catch {
    failed(res);
  }
}

export async function recoveryCodeController(config: AppConfig, req: Request, res: Response): Promise<void> {
  const auth = context(req, res);
  if (!auth) return;
  try {
    await consumeRecoveryCode(auth, res, config, req.body.code);
    sendSuccess(res, undefined, "Recovery code accepted.");
  } catch {
    failed(res);
  }
}
