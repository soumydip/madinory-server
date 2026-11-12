import { createHash, randomBytes } from "node:crypto";
import type { Response } from "express";
import type { AppConfig } from "../../../config.js";
import type { AuthContext } from "../types/auth.types.js";
import { setSupabaseSession } from "./session.service.js";
import { ServiceError } from "../../../errors/service-error.js";

const recoveryCodeCount = 10;

function hashRecoveryCode(code: string, config: AppConfig): string {
  return createHash("sha256")
    .update(`${config.CSRF_SECRET ?? "development-only"}:${code}`)
    .digest("hex");
}

function generateRecoveryCode(): string {
  return randomBytes(6).toString("hex").toUpperCase();
}

export async function enrollTotp(context: AuthContext): Promise<{
  id: string;
  qrCode: string;
  secret: string;
  uri: string;
}> {
  const { data, error } = await context.client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Medinory authenticator"
  });
  if (error || !data) throw error ?? new Error("MFA enrollment failed");
  return { id: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri };
}

export async function verifyTotp(
  context: AuthContext,
  response: Response,
  config: AppConfig,
  factorId: string,
  code: string
): Promise<string[]> {
  const { data: challenge, error: challengeError } = await context.client.auth.mfa.challenge({ factorId });
  if (challengeError || !challenge) throw challengeError ?? new Error("MFA challenge failed");
  const { data, error } = await context.client.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code
  });
  if (error) throw error;
  const { data: sessionData, error: sessionError } = await context.client.auth.getSession();
  if (sessionError || !sessionData.session) throw sessionError ?? new Error("MFA session unavailable");
  setSupabaseSession(response, config, sessionData.session);

  const codes = Array.from({ length: recoveryCodeCount }, generateRecoveryCode);
  const { error: insertError } = await context.client.from("mfa_recovery_codes").insert(
    codes.map((value) => ({ user_id: context.user.id, code_hash: hashRecoveryCode(value, config) }))
  );
  if (insertError) throw insertError;
  return codes;
}

export async function challengeTotp(context: AuthContext, factorId: string): Promise<string> {
  const { data, error } = await context.client.auth.mfa.challenge({ factorId });
  if (error || !data) throw error ?? new Error("MFA challenge failed");
  return data.id;
}

export async function listTotpFactors(context: AuthContext): Promise<Array<{ id: string; status: string; friendlyName?: string }>> {
  const { data, error } = await context.client.auth.mfa.listFactors();
  if (error) throw new ServiceError(503, "mfa_unavailable", "Multi-factor authentication is temporarily unavailable.");
  return data.totp.map((factor) => ({
    id: factor.id,
    status: factor.status,
    friendlyName: factor.friendly_name,
  }));
}

export async function disableTotp(context: AuthContext, factorId: string): Promise<void> {
  const { error } = await context.client.auth.mfa.unenroll({ factorId });
  if (error) throw new ServiceError(400, "mfa_disable_failed", "Multi-factor authentication could not be disabled.");
}

export async function verifyChallenge(
  context: AuthContext,
  response: Response,
  config: AppConfig,
  factorId: string,
  challengeId: string,
  code: string
): Promise<void> {
  const { data, error } = await context.client.auth.mfa.verify({ factorId, challengeId, code });
  if (error) throw error;
  const { data: sessionData, error: sessionError } = await context.client.auth.getSession();
  if (sessionError || !sessionData.session) throw sessionError ?? new Error("MFA session unavailable");
  setSupabaseSession(response, config, sessionData.session);
}

export async function consumeRecoveryCode(
  context: AuthContext,
  response: Response,
  config: AppConfig,
  code: string
): Promise<void> {
  const codeHash = hashRecoveryCode(code, config);
  const { data, error } = await context.client
    .from("mfa_recovery_codes")
    .select("id")
    .eq("user_id", context.user.id)
    .eq("code_hash", codeHash)
    .is("consumed_at", null)
    .maybeSingle();
  if (error || !data) throw error ?? new Error("Recovery code is invalid");
  const { error: updateError } = await context.client
    .from("mfa_recovery_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", data.id)
    .is("consumed_at", null);
  if (updateError) throw updateError;
  response.cookie("medinory_mfa_recovery", "used", {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    path: "/"
  });
}
