import axios, { type AxiosInstance } from "axios";

export interface RequestOptions {
  params?: Record<string, unknown>;
}

/**
 * Thin HTTP executor for the LoyaltyOS REST API. It does not know about
 * individual tools — each tool builds its own path, query, and body from the
 * shared `@loyaltyos/api-contract` schemas, then calls `get`/`post` here.
 */
export class LoyaltyOSClient {
  private readonly http: AxiosInstance;

  constructor(baseUrl: string, apiKey: string) {
    this.http = axios.create({
      baseURL: baseUrl,
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      timeout: 15_000,
    });
  }

  async get<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
    const { data } = await this.http.get<T>(path, { params: options?.params });
    return data;
  }

  async post<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    const { data } = await this.http.post<T>(path, body, { params: options?.params });
    return data;
  }
}
