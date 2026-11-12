import type { NextFunction, Request, Response } from "express";
import { matchedData, validationResult } from "express-validator";
import { sendError } from "../http/response.js";

export function validate(req: Request, res: Response, next: NextFunction): void {
  const result = validationResult(req);
  const validData = matchedData(req, { onlyValidData: true });
  const unknownFields = Object.keys(req.body ?? {}).filter((key) => !(key in validData));
  if (!result.isEmpty() || unknownFields.length > 0) {
    sendError(res, 422, "validation_error", "Please check the provided information.", [
          ...result.array().map((issue) => ({
          field: "path" in issue ? issue.path : "request",
          message: issue.msg
          })),
          ...unknownFields.map((field) => ({ field, message: "This field is not allowed." }))
        ]);
    return;
  }

  req.body = validData;
  next();
}
