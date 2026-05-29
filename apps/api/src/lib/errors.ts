/**
 * Structured error for API responses. The error handler localizes the `code`
 * into a human-readable `message` based on the request's Accept-Language header.
 */
export class LoyaltyError extends Error {
  public readonly code: string;
  public readonly params?: Record<string, unknown>;
  public readonly httpStatus: number;

  constructor(code: string, httpStatus = 400, params?: Record<string, unknown>) {
    super(code);
    this.name = "LoyaltyError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.params = params;
  }
}
