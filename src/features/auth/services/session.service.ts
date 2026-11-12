import type { Response } from "express";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../../../config.js";
import { createSupabaseClient } from "../../../supabase.js";

const accessCookie = "medinory_access";
const refreshCookie = "medinory_refresh";

function cookieOptions(config: AppConfig, maxAge: number) {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax" as const,
    domain: config.COOKIE_DOMAIN,
    path: "/",
    maxAge
  };
}

export function setSessionCookies(
  response: Response,
  config: AppConfig,
  accessToken: string,
  refreshToken: string,
  expiresIn: number
): void {
  response.cookie(accessCookie, accessToken, cookieOptions(config, expiresIn * 1000));
  response.cookie(refreshCookie, refreshToken, cookieOptions(config, 30 * 24 * 60 * 60 * 1000));
}

export function clearSessionCookies(response: Response, config: AppConfig): void {
  const options = cookieOptions(config, 0);
  response.clearCookie(accessCookie, options);
  response.clearCookie(refreshCookie, options);
}

export function setSupabaseSession(response: Response, config: AppConfig, session: Session): void {
  setSessionCookies(response, config, session.access_token, session.refresh_token, session.expires_in);
}

export async function refreshSession(
  config: AppConfig,
  response: Response,
  refreshToken: string,
): Promise<void> {
  const client = createSupabaseClient(config);
  if (!client) throw new Error("Supabase authentication is not configured");
  const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) throw error ?? new Error("Session refresh failed");
  setSupabaseSession(response, config, data.session);
}

export function clearAuthSession(response: Response, config: AppConfig): void {
  clearSessionCookies(response, config);
}

export async function revokeSession(client: SupabaseClient, accessToken: string): Promise<void> {
  client.auth.setSession({ access_token: accessToken, refresh_token: "" });
  await client.auth.signOut({ scope: "local" });
}
