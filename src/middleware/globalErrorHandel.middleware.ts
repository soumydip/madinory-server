import type { Request, Response, NextFunction } from "express";
import ServiceError from "../helper/error.helper.js";

// Supabase error codes
const SUPABASE_ERROR_CODES: Record<
  string,
  { status: number; message: string }
> = {
  "23505": { status: 409, message: "Duplicate value entered for unique field" },
  "23503": { status: 404, message: "Referenced record not found" },
  "23502": { status: 400, message: "Required field is missing" },
  PGRST116: { status: 404, message: "No data found" },
  PGRST301: { status: 401, message: "Unauthorized" },
  PGRST302: { status: 403, message: "Forbidden" },
  PGRST303: { status: 404, message: "Not found" },
  PGRST304: { status: 400, message: "Bad Request" },
};

const globalErrorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  console.log("Error caught by global error handler:", err);

  //  Custom Service Error
  if (err instanceof ServiceError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
  }

  //  Supabase / PostgreSQL Error
  if (err?.code) {
    const code = String(err.code);
    const supabaseErr = SUPABASE_ERROR_CODES[code];
    if (supabaseErr) {
      const { status, message } = supabaseErr;
      return res.status(status).json({
        success: false,
        message,
      });
    }
  }

  console.error(`[CRITICAL ERROR] Time: ${new Date().toISOString()}`);
  console.error(`URL: ${req.originalUrl}`);
  console.error(`Details: ${err.stack || err.message}`);

  return res.status(500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
};

export default globalErrorHandler;
