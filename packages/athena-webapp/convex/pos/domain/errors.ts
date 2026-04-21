export type PosServerErrorCode =
  | "validationFailed"
  | "terminalUnavailable"
  | "cashierMismatch"
  | "sessionExpired"
  | "notFound";

export class PosServerError extends Error {
  constructor(
    public readonly code: PosServerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PosServerError";
  }
}
