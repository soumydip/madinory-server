export class ServiceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Array<{ field: string; message: string }>;

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: Array<{ field: string; message: string }>,
  ) {
    super(message);
    this.name = "ServiceError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}
