import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },

  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.body",
      "access_token",
      "refresh_token",
      "code",
      "state",
      "phone",
      "phone_e164"
    ],
    censor: "[REDACTED]"
  },
  
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      singleLine: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname"
    }
  }
});