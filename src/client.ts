import type { Config } from "./config";

export type Query = Record<string, string | number | boolean | undefined>;

export interface Client {
  get<T>(path: string, query?: Query): Promise<T>;
  post<T>(path: string, body: unknown, query?: Query): Promise<T>;
}

export class BambooHRApiError extends Error {
  status: number;
  endpoint: string;
  detail?: string;

  constructor(status: number, endpoint: string, detail?: string) {
    super(BambooHRApiError.describe(status, endpoint, detail));
    this.name = "BambooHRApiError";
    this.status = status;
    this.endpoint = endpoint;
    this.detail = detail;
  }

  private static describe(status: number, endpoint: string, detail?: string): string {
    let msg = status === 0
      ? `BambooHR request to ${endpoint} failed: ${detail ?? "network error"}`
      : `BambooHR returned ${status} for ${endpoint}${detail ? `: ${detail}` : ""}`;
    if (status === 401) msg += ". Check that the enrolled API key is valid (run `enroll` again).";
    if (status === 403) msg += ". The API key's BambooHR access level does not allow this data.";
    return msg;
  }
}

const RETRY_STATUSES = new Set([429, 503]);
const DEFAULT_RETRY_DELAY_MS = 1000;
const MAX_RETRY_AFTER_SECONDS = 5;

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Delay before the single retry: `Retry-After` in seconds when present and short, else one second. */
function retryDelayMs(response: Response): number {
  const header = response.headers.get("retry-after");
  const seconds = header === null ? NaN : Number(header);
  if (Number.isFinite(seconds) && seconds > 0 && seconds <= MAX_RETRY_AFTER_SECONDS) {
    return seconds * 1000;
  }
  return DEFAULT_RETRY_DELAY_MS;
}

export function createClient(
  config: Pick<Config, "token" | "companyDomain">,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = defaultSleep
): Client {
  const base = `https://${config.companyDomain}.bamboohr.com/api/v1`;
  const auth = "Basic " + Buffer.from(`${config.token}:x`).toString("base64");

  async function request<T>(method: "GET" | "POST", path: string, query: Query, body?: unknown): Promise<T> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    const url = `${base}${path}${qs ? `?${qs}` : ""}`;
    const headers: Record<string, string> = { Authorization: auth, Accept: "application/json" };
    // BambooHR only recognises the exact string; "application/json; charset=UTF-8" is parsed as XML.
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const send = async (): Promise<Response> => {
      try {
        return await fetchImpl(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (e) {
        throw new BambooHRApiError(0, path, e instanceof Error ? e.message : String(e));
      }
    };

    let response = await send();
    // Rate limiting and transient unavailability get one retry; the overview
    // makes one call per employee, so a single 429 should not fail a whole row.
    if (RETRY_STATUSES.has(response.status)) {
      await sleep(retryDelayMs(response));
      response = await send();
    }

    if (!response.ok) {
      const detail = response.headers.get("x-bamboohr-error-message") ?? undefined;
      throw new BambooHRApiError(response.status, path, detail);
    }
    return (await response.json()) as T;
  }

  return {
    get: <T>(path: string, query: Query = {}) => request<T>("GET", path, query),
    post: <T>(path: string, body: unknown, query: Query = {}) => request<T>("POST", path, query, body),
  };
}
