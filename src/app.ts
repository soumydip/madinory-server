import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { AppConfig } from "./config.js";
import { logger } from "./logger.js";
import { authenticate } from "./middleware/auth.js";
import { createRateLimiter } from "./middleware/rate-limit.js";
import { csrfProtection } from "./middleware/security.js";
import { body } from "express-validator";
import { validate } from "./middleware/validate.js";
import { createAuthRouter } from "./features/auth/index.js";
import { createAdminRouter } from "./features/admin/index.js";
import { ServiceError } from "./errors/service-error.js";
import { sendError, sendSuccess } from "./http/response.js";
import { validateJWTIfPresent } from "./jwt/validateJWT.middleware.js";

export function createApp(config: AppConfig) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: config.frontendOrigins, credentials: true }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use(validateJWTIfPresent(config));
    app.use(pinoHttp({ logger }));
  app.use(csrfProtection(config));
  app.use(createRateLimiter(config, "global", 100, 60));

  app.get("/health", (_req, res) => sendSuccess(res, { status: "ok" }));

  app.use("/", createAuthRouter(config));
  app.use("/admin", createAdminRouter(config));

  if (config.NODE_ENV === "test") {
    app.post("/test/validate", body("name").isString().notEmpty(), validate, (req, res) => {
      sendSuccess(res, req.body);
    });
  }

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ServiceError) {
      sendError(res, err.status, err.code, err.message, err.fields);
      return;
    }
    logger.error({ err }, "Unhandled request error");
    sendError(res, 500, "internal_error", "Something went wrong.");
  });

  return app;
}
