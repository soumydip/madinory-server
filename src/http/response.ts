import type { Response } from "express";

export function sendSuccess<T>(
  response: Response,
  data?: T,
  message?: string,
  status = 200,
): void {
  response.status(status).json({
    success: true,
    ...(message ? { message } : {}),
    ...(data === undefined ? {} : { data }),
  });
}

export function sendError(
  response: Response,
  status: number,
  code: string,
  message: string,
  fields?: Array<{ field: string; message: string }>,
): void {
  response.status(status).json({
    success: false,
    error: {
      code,
      message,
      ...(fields?.length ? { fields } : {}),
    },
  });
}
