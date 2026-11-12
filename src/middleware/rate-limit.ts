import type { NextFunction, Request, Response } from "express";
import { Redis } from "ioredis";
import type { AppConfig } from "../config.js";
import { sendError } from "../http/response.js";

export function createRateLimiter(config: AppConfig, name: string, limit: number, windowSeconds: number) {
  const redis = config.REDIS_URL ? new Redis(config.REDIS_URL, { lazyConnect: true }) : null;
  const local = new Map<string, { count: number; resetAt: number }>();

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = `${name}:${req.ip}`;
    if (redis) {
      try {
        if (redis.status === "wait") await redis.connect();
        const count = await redis.incr(key);
        if (count === 1) await redis.expire(key, windowSeconds);
        if (count > limit) {
          sendError(res, 429, "rate_limited", "Too many requests. Please try again later.");
          return;
        }
        next();
        return;
      } catch {
        sendError(res, 503, "rate_limit_unavailable", "This service is temporarily unavailable.");
        return;
      }
    }

    if (config.isProduction) {
      sendError(res, 503, "rate_limit_unavailable", "This service is temporarily unavailable.");
      return;
    }

    const now = Date.now();
    const current = local.get(key);
    if (!current || current.resetAt <= now) {
      local.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      next();
      return;
    }
    current.count += 1;
    if (current.count > limit) {
      sendError(res, 429, "rate_limited", "Too many requests. Please try again later.");
      return;
    }
    next();
  };
}
