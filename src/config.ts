export type AppConfig = {
  NODE_ENV: "development" | "test" | "production";
  PORT: number;
  FRONTEND_ORIGINS: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_PROFILE_BUCKET?: string;
  REDIS_URL?: string;
  COOKIE_DOMAIN?: string;
  CSRF_SECRET?: string;
  BACKEND_PUBLIC_URL: string;
  FRONTEND_URL: string;
  frontendOrigins: string[];
  isProduction: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  if (!["development", "test", "production"].includes(nodeEnv)) {
    throw new Error("NODE_ENV must be development, test, or production");
  }
  const port = Number(env.PORT ?? 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  const frontendOrigins = (env.FRONTEND_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const config: AppConfig = {
    NODE_ENV: nodeEnv as AppConfig["NODE_ENV"],
    PORT: port,
    FRONTEND_ORIGINS: env.FRONTEND_ORIGINS ?? "http://localhost:3000",
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_PROFILE_BUCKET: env.SUPABASE_PROFILE_BUCKET,
    REDIS_URL: env.REDIS_URL,
    COOKIE_DOMAIN: env.COOKIE_DOMAIN,
    CSRF_SECRET: env.CSRF_SECRET,
    BACKEND_PUBLIC_URL: env.BACKEND_PUBLIC_URL ?? "http://localhost:5000",
    FRONTEND_URL:
      env.FRONTEND_URL ?? frontendOrigins[0] ?? "http://localhost:3000",
    frontendOrigins,
    isProduction: nodeEnv === "production",
  };

  if (
    config.isProduction &&
    (!config.SUPABASE_URL ||
      !config.SUPABASE_ANON_KEY ||
      !config.REDIS_URL ||
      !config.CSRF_SECRET)
  ) {
    throw new Error(
      "SUPABASE_URL, SUPABASE_ANON_KEY, REDIS_URL, and CSRF_SECRET are required in production",
    );
  }

  return config;
}
