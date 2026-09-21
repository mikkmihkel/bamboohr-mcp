import { describe, expect, it, vi } from "vitest";
import { compareVersions, evaluateRevocation, runSelfCheck } from "../src/selfCheck";

const URL_OK = "https://example.test/revocations.json";

function fakeFetch(status: number, body: unknown, ok = true) {
  return vi.fn(async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  ) as unknown as typeof fetch;
}

describe("compareVersions", () => {
  it("compares major, minor and patch", () => {
    expect(compareVersions("4.0.0", "4.0.0")).toBe(0);
    expect(compareVersions("3.9.9", "4.0.0")).toBe(-1);
    expect(compareVersions("4.1.0", "4.0.9")).toBe(1);
    expect(compareVersions("4.0.10", "4.0.9")).toBe(1);
  });

  it("ignores prerelease and build metadata and missing parts", () => {
    expect(compareVersions("4.0.0-rc.1", "4.0.0")).toBe(0);
    expect(compareVersions("4.0.0+build7", "4.0.0")).toBe(0);
    expect(compareVersions("4", "4.0.0")).toBe(0);
    expect(compareVersions("nonsense", "0.0.0")).toBe(0);
  });
});

describe("evaluateRevocation", () => {
  it("passes a version that is not listed", () => {
    expect(evaluateRevocation({ schemaVersion: 1, revokedVersions: ["3.0.0"] }, "4.0.0")).toEqual({ status: "ok" });
  });

  it("revokes a listed version and includes the document message", () => {
    const result = evaluateRevocation(
      { schemaVersion: 1, revokedVersions: ["4.0.0"], message: "Upgrade to 4.0.1." },
      "4.0.0"
    );
    expect(result.status).toBe("revoked");
    expect((result as { reason: string }).reason).toContain("4.0.0");
    expect((result as { reason: string }).reason).toContain("Upgrade to 4.0.1.");
  });

  it("revokes anything below minimumVersion", () => {
    expect(evaluateRevocation({ schemaVersion: 1, minimumVersion: "4.0.0" }, "3.9.9").status).toBe("revoked");
    expect(evaluateRevocation({ schemaVersion: 1, minimumVersion: "4.0.0" }, "4.0.0").status).toBe("ok");
  });
});

describe("runSelfCheck", () => {
  it("sends no credentials, only Accept and User-Agent", async () => {
    const f = fakeFetch(200, { schemaVersion: 1 });
    await runSelfCheck(URL_OK, "4.0.0", f);
    const [url, init] = (f as any).mock.calls[0];
    expect(url).toBe(URL_OK);
    expect(init.method).toBe("GET");
    expect(Object.keys(init.headers).sort()).toEqual(["Accept", "User-Agent"]);
    expect(init.headers["User-Agent"]).toBe("bamboohr-mcp/4.0.0");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns ok for a clean document and revoked for a listed version", async () => {
    await expect(runSelfCheck(URL_OK, "4.0.0", fakeFetch(200, { schemaVersion: 1 }))).resolves.toEqual({ status: "ok" });
    const revoked = await runSelfCheck(URL_OK, "4.0.0", fakeFetch(200, { schemaVersion: 1, revokedVersions: ["4.0.0"] }));
    expect(revoked.status).toBe("revoked");
  });

  it("refuses a non-https endpoint", async () => {
    await expect(runSelfCheck("http://example.test/r.json", "4.0.0", fakeFetch(200, {}))).rejects.toThrow(/https/);
    await expect(runSelfCheck("not a url", "4.0.0", fakeFetch(200, {}))).rejects.toThrow(/valid URL/);
  });

  it("is unavailable on a non-2xx status, invalid JSON or an unknown schema", async () => {
    expect((await runSelfCheck(URL_OK, "4.0.0", fakeFetch(503, {}))).status).toBe("unavailable");
    expect((await runSelfCheck(URL_OK, "4.0.0", fakeFetch(200, "{ not json"))).status).toBe("unavailable");
    expect((await runSelfCheck(URL_OK, "4.0.0", fakeFetch(200, { schemaVersion: 2 }))).status).toBe("unavailable");
  });

  it("is unavailable when the request fails", async () => {
    const f = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof fetch;
    const result = await runSelfCheck(URL_OK, "4.0.0", f);
    expect(result).toEqual({ status: "unavailable", reason: "revocation endpoint unreachable: getaddrinfo ENOTFOUND" });
  });

  it("aborts a hanging endpoint after the timeout", async () => {
    const f = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      })) as unknown as typeof fetch;
    const result = await runSelfCheck(URL_OK, "4.0.0", f, 10);
    expect(result.status).toBe("unavailable");
    expect((result as { reason: string }).reason).toContain("10 ms");
  });
});
