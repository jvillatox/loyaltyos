/** Two-letter country codes supported by Apprecio. */
export type ApprecioCountry = "MX" | "CL" | "CO" | "PE" | "EC";

/** Prebuilt API base URLs keyed by country. */
export const APPRECIO_BASE_URLS: Record<ApprecioCountry, string> = {
  MX: "https://apiv2.dcanje.mx/api",
  CL: "https://api.apprecio.cl/api",
  CO: "https://apiv2.apprecio.com.co/api",
  PE: "https://apiv2.apprecio.pe/api",
  EC: "https://apiv2.ec.dcanje.com/api",
};

export type IdentifierType = "email" | "rut";

export interface ApprecioConfig {
  /** Full API base URL (use APPRECIO_BASE_URLS or a custom one). */
  apiBase: string;
  /** Public token that identifies the merchant. */
  publicToken: string;
  /** Private secret used for MD5 hash signing. Never logged. */
  privateToken: string;
  /** How externalMemberRef is interpreted. */
  identifierType: IdentifierType;
  /** HTTP request timeout in ms. Default 10000. */
  timeoutMs?: number;
  /** Default transaction description. */
  description?: string;
}

// ── Optimistic Response Types ───────────────────────────────────
// Response shapes are NOT documented in the PDF. These types use
// `unknown` for unconfirmed fields and will be tightened once real
// sandbox responses are observed.

export interface ApprecioBaseResponse {
  success?: boolean;
  message?: string;
  error?: string;
  data?: unknown;
}

export interface ApprecioAccumulateResponse extends ApprecioBaseResponse {
  data?: {
    saldo_actual?: number;
    transaction_id?: string;
    [key: string]: unknown;
  };
}

export interface ApprecioBalanceResponse extends ApprecioBaseResponse {
  data?: {
    saldo?: number;
    [key: string]: unknown;
  };
}

export interface ApprecioHistoryResponse extends ApprecioBaseResponse {
  data?: unknown[];
}

export class ApprecioAuthError extends Error {
  constructor(message: string) {
    super(`Apprecio auth error: ${message}`);
    this.name = "ApprecioAuthError";
  }
}

export class ApprecioConfigError extends Error {
  constructor(message: string) {
    super(`Apprecio config error: ${message}`);
    this.name = "ApprecioConfigError";
  }
}
