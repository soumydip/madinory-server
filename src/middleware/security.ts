import type { NextFunction, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import type { AppConfig } from "../config.js";
import { sendError } from "../http/response.js";

export function csrfProtection(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.cookies?.medinory_csrf) {
      res.cookie("medinory_csrf", randomBytes(32).toString("hex"), {
        httpOnly: false,
        secure: config.isProduction,
        sameSite: "lax",
        domain: config.COOKIE_DOMAIN,
        path: "/"
      });
    }

    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      next();
      return;
    }

    if (!req.cookies?.medinory_access && !req.cookies?.medinory_refresh) {
      next();
      return;
    }

    const origin = req.get("origin");
    const csrf = req.get("x-csrf-token");
    if (!origin || !config.frontendOrigins.includes(origin) || !csrf || csrf !== req.cookies?.medinory_csrf) {
      sendError(res, 403, "csrf_failed", "The request could not be verified.");
      return;
    }
    next();
  };
}
