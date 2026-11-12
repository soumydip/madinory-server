import type { NextFunction, Request, Response } from "express";
import { createUserScopedClient, createSupabaseClient } from "../supabase.js";
import type { AppConfig } from "../config.js";
import type { AuthenticatedUser } from "../types/express.js";
import { sendError } from "../http/response.js";

export function authenticate(config: AppConfig) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const bearer = req.get("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
    const token = bearer ?? req.cookies?.medinory_access;
    if (!token) {
      sendError(res, 401, "unauthenticated", "Authentication is required.");
      return;
    }

    const supabase = createSupabaseClient(config);
    if (!supabase) {
      sendError(res, 503, "auth_unavailable", "Authentication is temporarily unavailable.");
      return;
    }

    const user = req.user;
    const result = user ? { data: { user }, error: null } : await supabase.auth.getUser(token);
    if (result.error || !result.data.user) {
      sendError(res, 401, "unauthenticated", "Authentication is required.");
      return;
    }

    req.auth = {
      user: result.data.user as AuthenticatedUser,
      accessToken: token,
      client: createUserScopedClient(config, token)
    };
    next();
  };
}

export function requireRole(role: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.auth?.user.app_metadata?.role !== role) {
      sendError(res, 403, "forbidden", "You do not have permission to perform this action.");
      return;
    }
    next();
  };
}

export function requireAal2(req: Request, res: Response, next: NextFunction): void {
  if (req.auth?.user.aal !== "aal2") {
    sendError(res, 403, "mfa_required", "Multi-factor authentication is required.");
    return;
  }
  next();
}

export function requireMfaSubject(req: Request, res: Response, next: NextFunction): void {
  const role = req.auth?.user.app_metadata?.role;
  if (role !== "doctor" && role !== "admin") {
    sendError(res, 403, "forbidden", "This action is restricted to doctors and administrators.");
    return;
  }
  next();
}

export function requireHospitalStaff(_hospitalIdParam: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.auth) {
      sendError(res, 401, "unauthenticated", "Authentication is required.");
      return;
    }

    const hospitalId = req.params[_hospitalIdParam];
    if (!hospitalId) {
      sendError(res, 403, "forbidden", "You do not have permission to perform this action.");
      return;
    }

    const { data, error } = await req.auth.client
      .from("hospital_staff")
      .select("id")
      .eq("hospital_id", hospitalId)
      .eq("user_id", req.auth.user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      sendError(res, 503, "authorization_unavailable", "Authorization is temporarily unavailable.");
      return;
    }
    if (!data) {
      sendError(res, 403, "forbidden", "You do not have permission to perform this action.");
      return;
    }
    next();
  };
}
