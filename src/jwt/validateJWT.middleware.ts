import type { NextFunction, Request, Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import type { User } from "@supabase/supabase-js";
import type { AppConfig } from "../config.js";
import { sendError } from "../http/response.js";
import { createSupabaseClient } from "../supabase.js";

function bearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? null;
}

const verificationCacheTtlSeconds = 15;
const verificationLockTtlMilliseconds = 5_000;
const verificationWaitMilliseconds = 50;
const verificationWaitAttempts = 20;

function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cacheKey(token: string): string {
  return `auth:jwt:user:${tokenFingerprint(token)}`;
}

function lockKey(token: string): string {
  return `auth:jwt:lock:${tokenFingerprint(token)}`;
}

function tokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

async function getCachedUser(redis: Redis | null, token: string): Promise<User | null> {
  if (!redis) return null;
  const exp = tokenExpiry(token);
  if (exp !== null && exp <= Math.floor(Date.now() / 1000)) {
    await redis.del(cacheKey(token));
    return null;
  }
  const cached = await redis.get(cacheKey(token));
  if (!cached) return null;
  try {
    return JSON.parse(cached) as User;
  } catch {
    await redis.del(cacheKey(token));
    return null;
  }
}

async function ensureRedis(redis: Redis | null): Promise<void> {
  if (redis && redis.status === "wait") await redis.connect();
}

async function releaseLock(redis: Redis, key: string, value: string): Promise<void> {
  await redis.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    key,
    value,
  );
}

async function verifyWithSupabase(config: AppConfig, token: string): Promise<User | null> {
  const supabase = createSupabaseClient(config);
  if (!supabase) {
    throw new Error("Supabase authentication is not configured");
  }

  const { data, error } = await supabase.auth.getUser(token);
  return error || !data.user ? null : data.user;
}

async function validateToken(config: AppConfig, token: string, req: Request, res: Response, redis: Redis | null): Promise<boolean> {
  let lockValue: string | null = null;
  try {
    await ensureRedis(redis);
    const cached = await getCachedUser(redis, token);
    if (cached) {
      req.user = cached;
      return true;
    }

    if (redis) {
      const candidateLockValue = randomUUID();
      const acquired = await redis.set(lockKey(token), candidateLockValue, "PX", verificationLockTtlMilliseconds, "NX");
      if (acquired) lockValue = candidateLockValue;
      if (!acquired) {
        for (let attempt = 0; attempt < verificationWaitAttempts; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, verificationWaitMilliseconds));
          const synchronizedUser = await getCachedUser(redis, token);
          if (synchronizedUser) {
            req.user = synchronizedUser;
            return true;
          }
        }
      }
    }

    const user = await verifyWithSupabase(config, token);
    if (!user) {
      sendError(res, 401, "invalid_token", "The access token is invalid or expired.");
      return false;
    }
    if (redis) {
      const exp = tokenExpiry(token);
      const remainingSeconds = exp === null ? verificationCacheTtlSeconds : exp - Math.floor(Date.now() / 1000);
      const cacheTtl = Math.min(verificationCacheTtlSeconds, remainingSeconds);
      if (cacheTtl > 0) {
        await redis.set(cacheKey(token), JSON.stringify(user), "EX", cacheTtl);
      }
    }
    req.user = user;
    return true;
  } catch {
    sendError(res, 503, "auth_unavailable", "Authentication is temporarily unavailable.");
    return false;
  } finally {
    if (redis) {
      if (lockValue) {
        try {
          await releaseLock(redis, lockKey(token), lockValue);
        } catch {
        }
      }
    }
  }
}

export function validateJWT(config: AppConfig) {
  const redis = config.REDIS_URL ? new Redis(config.REDIS_URL, { lazyConnect: true }) : null;
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = bearerToken(req.get("authorization"));
    if (!token) {
      sendError(res, 401, "invalid_token", "A valid bearer token is required.");
      return;
    }
    if (await validateToken(config, token, req, res, redis)) next();
  };
}

export function validateJWTIfPresent(config: AppConfig) {
  const redis = config.REDIS_URL ? new Redis(config.REDIS_URL, { lazyConnect: true }) : null;
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authorization = req.get("authorization");
    if (!authorization) {
      next();
      return;
    }

    const token = bearerToken(authorization);
    if (!token) {
      sendError(res, 401, "invalid_token", "A valid bearer token is required.");
      return;
    }
    if (await validateToken(config, token, req, res, redis)) next();
  };
}

export default validateJWT;
