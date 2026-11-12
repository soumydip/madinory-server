import { createHash, randomBytes } from "node:crypto";
import type { Response } from "express";
import { createClient } from "@supabase/supabase-js";
import type { AppConfig } from "../../../config.js";
import { createSupabaseClient } from "../../../supabase.js";
import { setSessionCookies } from "./session.service.js";

const oauthCookie = "medinory_oauth";
const oauthMaxAge = 10 * 60 * 1000;

type OAuthState = {
  state: string;
  verifier: string;
  next: string;
};

function isSafeNext(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\");
}

function createVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function createChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function redirectUri(config: AppConfig): string {
  return `${config.BACKEND_PUBLIC_URL.replace(/\/$/, "")}/auth/google/callback`;
}

export function getOAuthFailureRedirect(config: AppConfig): string {
  return `${config.FRONTEND_URL.replace(/\/$/, "")}/login?error=oauth_failed`;
}

export function beginGoogleOAuth(config: AppConfig, response: Response, requestedNext: unknown): string {
  const next = isSafeNext(requestedNext) ? requestedNext : "/dashboard";
  const state = randomBytes(32).toString("base64url");
  const verifier = createVerifier();
  const oauthState: OAuthState = { state, verifier, next };

  response.cookie(oauthCookie, Buffer.from(JSON.stringify(oauthState)).toString("base64url"), {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    domain: config.COOKIE_DOMAIN,
    path: "/auth/google",
    maxAge: oauthMaxAge
  });

  if (!config.SUPABASE_URL) {
    return getOAuthFailureRedirect(config);
  }

  const url = new URL(`${config.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/authorize`);
  url.searchParams.set("provider", "google");
  url.searchParams.set("redirect_to", redirectUri(config));
  url.searchParams.set("code_challenge", createChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("scopes", "openid email profile");
  return url.toString();
}

function readOAuthState(value: unknown): OAuthState | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<OAuthState>;
    if (
      typeof parsed.state !== "string" ||
      typeof parsed.verifier !== "string" ||
      !isSafeNext(parsed.next)
    ) return null;
    return parsed as OAuthState;
  } catch {
    return null;
  }
}

export async function finishGoogleOAuth(
  config: AppConfig,
  response: Response,
  cookieValue: unknown,
  callbackState: unknown,
  code: unknown
): Promise<string> {
  const saved = readOAuthState(cookieValue);
  if (!saved || typeof callbackState !== "string" || saved.state !== callbackState || typeof code !== "string" || !code) {
    throw new Error("OAuth callback validation failed");
  }
  if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
    throw new Error("Supabase authentication is not configured");
  }

  const storage = {
    getItem: async (key: string) => key.includes("code-verifier") ? saved.verifier : null,
    setItem: async () => undefined,
    removeItem: async () => undefined
  };
  const client = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      storage,
      storageKey: "medinory-oauth"
    }
  });
  const { data, error } = await client.auth.exchangeCodeForSession(code);
  if (error || !data.session || !data.user?.email_confirmed_at) {
    throw new Error("OAuth account was not verified");
  }

  setSessionCookies(
    response,
    config,
    data.session.access_token,
    data.session.refresh_token,
    data.session.expires_in
  );
  response.clearCookie(oauthCookie, { path: "/auth/google", domain: config.COOKIE_DOMAIN });
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("full_name")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  return profile?.full_name ? saved.next : "/onboarding";
}
