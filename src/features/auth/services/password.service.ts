import type { Response } from "express";
import type { AppConfig } from "../../../config.js";
import { createSupabaseClient } from "../../../supabase.js";
import { setSupabaseSession } from "./session.service.js";
import { ServiceError } from "../../../errors/service-error.js";

type AuthResult = {
  requiresMfa: boolean;
  requiresEnrollment: boolean;
  factorId?: string;
};

function getClient(config: AppConfig) {
  const client = createSupabaseClient(config);
  if (!client) throw new Error("Supabase authentication is not configured");
  return client;
}

async function getMfaState(
  client: ReturnType<typeof getClient>,
  role: string | undefined,
): Promise<Omit<AuthResult, "requiresMfa">> {
  const { data, error } = await client.auth.mfa.listFactors();
  if (error)
    throw new ServiceError(
      400,
      "registration_failed",
      "We could not create that account.",
    );
  const factor = data.totp.find((candidate) => candidate.status === "verified");
  const requiresEnrollment = (role === "admin" || role === "doctor") && !factor;
  return {
    requiresEnrollment,
    factorId: factor?.id,
  };
}

export async function registerWithPassword(
  config: AppConfig,
  response: Response,
  email: string,
  password: string,
  fullName: string,
): Promise<{ emailConfirmationRequired: boolean }> {
  const client = getClient(config);
  const { data, error } = await client.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      data: {
        full_name: fullName,
      },
    },
  });
  if (error)
    throw new ServiceError(
      503,
      "mfa_unavailable",
      "Multi-factor authentication is temporarily unavailable.",
    );
  if (data.session) setSupabaseSession(response, config, data.session);
  return { emailConfirmationRequired: !data.session };
}

export async function loginWithPassword(
  config: AppConfig,
  response: Response,
  email: string,
  password: string,
): Promise<AuthResult> {
  const client = getClient(config);
  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error || !data.session || !data.user) {
    throw new ServiceError(
      401,
      "invalid_credentials",
      "Email or password is incorrect.",
    );
  }

  setSupabaseSession(response, config, data.session);
  const mfa = await getMfaState(client, data.user.app_metadata?.role);
  return {
    ...mfa,
    requiresMfa: Boolean(mfa.factorId),
  };
}
