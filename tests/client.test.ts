import { describe, expect, it, vi } from "vitest";
import { BambooHRApiError, createClient } from "../src/client";

function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn(async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    })
  ) as unknown as typeof fetch;
}

const cfg = { token: "secret-key", companyDomain: "acme" };

describe("createClient", () => {
  it("builds the spec base URL and encodes the query", async () => {
    const f = fakeFetch(200, []);
    await createClient(cfg, f).get("/time_off/whos_out", { start: "2026-09-14", end: "2026-09-28", skip: undefined });
    const [url, init] = (f as any).mock.calls[0];
    expect(url).toBe("https://acme.bamboohr.com/api/v1/time_off/whos_out?start=2026-09-14&end=2026-09-28");
    expect(init.method).toBe("GET");
  });

  it("sends basic auth with the key as username and asks for JSON", async () => {
    const f = fakeFetch(200, {});
    await createClient(cfg, f).get("/meta/time_off/types");
    const [, init] = (f as any).mock.calls[0];
    expect(init.headers.Authorization).toBe("Basic " + Buffer.from("secret-key:x").toString("base64"));
    expect(init.headers.Accept).toBe("application/json");
  });

  it("returns parsed JSON", async () => {
    const f = fakeFetch(200, { hello: "world" });
    await expect(createClient(cfg, f).get("/x")).resolves.toEqual({ hello: "world" });
  });

  it("maps non-2xx to BambooHRApiError with the BambooHR error header", async () => {
    const f = fakeFetch(404, undefined, { "x-bamboohr-error-message": "Employee not found" });
    const err = await createClient(cfg, f).get("/employees/999/time_off/calculator").catch((e) => e);
    expect(err).toBeInstanceOf(BambooHRApiError);
    expect(err.status).toBe(404);
    expect(err.endpoint).toBe("/employees/999/time_off/calculator");
    expect(err.detail).toBe("Employee not found");
    expect(err.message).toMatch(/404/);
    expect(err.message).toMatch(/Employee not found/);
  });

  it("adds a permissions hint on 401 and 403", async () => {
    const err401 = await createClient(cfg, fakeFetch(401, undefined)).get("/x").catch((e) => e);
    const err403 = await createClient(cfg, fakeFetch(403, undefined)).get("/x").catch((e) => e);
    expect(err401.message).toMatch(/API key/i);
    expect(err403.message).toMatch(/access level/i);
  });

  it("wraps network failures", async () => {
    const f = vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    const err = await createClient(cfg, f).get("/x").catch((e) => e);
    expect(err).toBeInstanceOf(BambooHRApiError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/fetch failed/);
  });

  it("post sends a JSON body with an exact application/json content type", async () => {
    const f = fakeFetch(200, { title: "r" });
    await createClient(cfg, f).post("/reports/custom", { fields: ["firstName"] }, { format: "JSON" });
    const [url, init] = (f as any).mock.calls[0];
    expect(url).toBe("https://acme.bamboohr.com/api/v1/reports/custom?format=JSON");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.Accept).toBe("application/json");
    expect(init.headers.Authorization).toBe("Basic " + Buffer.from("secret-key:x").toString("base64"));
    expect(init.body).toBe(JSON.stringify({ fields: ["firstName"] }));
  });

  it("post retries once on 429 and returns the second response", async () => {
    const responses = [
      new Response("", { status: 429 }),
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }),
    ];
    const f = vi.fn(async () => responses.shift()!) as unknown as typeof fetch;
    const sleep = vi.fn(async () => {});
    await expect(createClient(cfg, f, sleep).post("/reports/custom", {})).resolves.toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("post maps errors like get", async () => {
    const f = fakeFetch(403, undefined, { "x-bamboohr-error-message": "No access" });
    const err = await createClient(cfg, f).post("/reports/custom", {}).catch((e) => e);
    expect(err).toBeInstanceOf(BambooHRApiError);
    expect(err.status).toBe(403);
    expect(err.message).toMatch(/access level/);
  });
});

describe("createClient retries", () => {
  function fetchSequence(responses: { status: number; body?: unknown; headers?: Record<string, string> }[]) {
    let i = 0;
    return vi.fn(async () => {
      const r = responses[Math.min(i++, responses.length - 1)];
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
        status: r.status,
        headers: { "content-type": "application/json", ...(r.headers ?? {}) },
      });
    }) as unknown as typeof fetch;
  }

  it("retries once after a 503 and returns the second response", async () => {
    const f = fetchSequence([{ status: 503 }, { status: 200, body: { hello: "world" } }]);
    const sleep = vi.fn(async () => {});
    await expect(createClient(cfg, f, sleep).get("/x")).resolves.toEqual({ hello: "world" });
    expect((f as any).mock.calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("honours a Retry-After header of at most 5 seconds on 429", async () => {
    const f = fetchSequence([
      { status: 429, headers: { "retry-after": "2" } },
      { status: 200, body: [] },
    ]);
    const sleep = vi.fn(async () => {});
    await createClient(cfg, f, sleep).get("/x");
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("ignores a Retry-After longer than 5 seconds and waits one second", async () => {
    const f = fetchSequence([
      { status: 429, headers: { "retry-after": "600" } },
      { status: 200, body: [] },
    ]);
    const sleep = vi.fn(async () => {});
    await createClient(cfg, f, sleep).get("/x");
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("gives up after one retry", async () => {
    const f = fetchSequence([{ status: 503 }, { status: 503 }]);
    const sleep = vi.fn(async () => {});
    const err = await createClient(cfg, f, sleep).get("/x").catch((e) => e);
    expect(err).toBeInstanceOf(BambooHRApiError);
    expect(err.status).toBe(503);
    expect((f as any).mock.calls).toHaveLength(2);
  });

  it("does not retry other error statuses", async () => {
    const f = fetchSequence([{ status: 404 }, { status: 200, body: {} }]);
    const sleep = vi.fn(async () => {});
    await createClient(cfg, f, sleep).get("/x").catch(() => {});
    expect((f as any).mock.calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
