import { describe, expect, it, vi } from "vitest";
import { resolveAppPaths } from "../src/appPaths";
import type { BambooHRApi } from "../src/bamboohr";
import { ConfigError, NotEnrolledError, type Config } from "../src/config";
import { CredentialStoreError } from "../src/credentialStore";
import { notEnrolledApi } from "../src/notEnrolledApi";
import { defaultSettings, type Settings } from "../src/settings";
import { deferredApi, resolveApi } from "../src/startup";

const paths = resolveAppPaths({ BAMBOOHR_MCP_DATA_DIR: "/nonexistent" }, "linux", "/nonexistent");
const settings = (over: Partial<Settings> = {}): Settings => ({ ...defaultSettings(), ...over });
const ok = async () => ({ status: "ok" as const });
const config = { token: "t", companyDomain: "acme", settings: defaultSettings(), paths, warnings: ["w1"] } as Config;
const realApi = { getUsers: vi.fn(async () => ["real"]) } as unknown as BambooHRApi;

async function callError(api: BambooHRApi): Promise<Error> {
  return (await api.getUsers().catch((e: Error) => e)) as Error;
}

describe("resolveApi", () => {
  it("returns the real API and passes on config warnings", async () => {
    const out = await resolveApi(paths, settings(), "4.2.0", { selfCheck: ok, loadConfig: async () => config, createApi: () => realApi });
    expect(out.api).toBe(realApi);
    expect(out.banner).toContain("acme.bamboohr.com");
    expect(out.warnings).toEqual(["w1"]);
  });

  it("serves no data from a revoked version, and never loads the key", async () => {
    const loadConfig = vi.fn(async () => config);
    const out = await resolveApi(paths, settings(), "4.0.0", {
      selfCheck: async () => ({ status: "revoked", reason: "broken build." }), loadConfig,
    });
    const err = await callError(out.api);
    expect(err.name).toBe("RevokedVersionError");
    expect(err.message).toMatch(/4\.0\.0.*revoked.*broken build.*releases\/latest/);
    expect(loadConfig).not.toHaveBeenCalled();
  });

  it("warns on an unreachable list, refuses only under strict self-check", async () => {
    const unavailable = async () => ({ status: "unavailable" as const, reason: "offline" });
    const lenient = await resolveApi(paths, settings(), "4.2.0", { selfCheck: unavailable, loadConfig: async () => config, createApi: () => realApi });
    expect(lenient.api).toBe(realApi);
    expect(lenient.warnings[0]).toContain("offline");
    const strict = await resolveApi(paths, settings({ strictSelfCheck: true }), "4.2.0", { selfCheck: unavailable, loadConfig: async () => config });
    expect((await callError(strict.api)).name).toBe("SelfCheckError");
  });

  it("treats a throwing self-check as unavailable", async () => {
    const out = await resolveApi(paths, settings(), "4.2.0", {
      selfCheck: async () => { throw new Error("boom"); }, loadConfig: async () => config, createApi: () => realApi,
    });
    expect(out.api).toBe(realApi);
  });

  it.each([
    ["not enrolled", new NotEnrolledError("No BambooHR API key"), "NotEnrolledError"],
    ["bad subdomain", new ConfigError("not a bare subdomain"), "ConfigError"],
    ["locked keyring", new CredentialStoreError("keyring locked", "Unlock it."), "CredentialStoreError"],
    ["anything else", new TypeError("surprise"), "StartupError"],
  ])("keeps serving on %s and answers every call with the reason", async (_label, error, name) => {
    const out = await resolveApi(paths, settings(), "4.2.0", { selfCheck: ok, loadConfig: async () => { throw error; } });
    const err = await callError(out.api);
    expect(err.name).toBe(name);
    expect(err.message).toContain(error.message);
  });
});

describe("deferredApi", () => {
  it("waits for the real API and delegates", async () => {
    let resolve!: (v: { api: BambooHRApi }) => void;
    const api = deferredApi(new Promise((r) => { resolve = r; }));
    const pending = api.getUsers();
    resolve({ api: realApi });
    expect(await pending).toEqual(["real"]);
  });

  it("settles with a stand-in API, whose Proxy answers `then` too", async () => {
    const api = deferredApi(Promise.resolve({ api: notEnrolledApi(new Error("no key")) }));
    expect((await callError(api)).message).toBe("no key");
    expect((api as unknown as { then?: unknown }).then).toBeUndefined();
  });
});
