import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveAppPaths, type AppPaths } from "../src/appPaths";
import { ConfigError, enrolmentCommand, loadConfig, NotEnrolledError } from "../src/config";
import type { CredentialStore } from "../src/credentialStore";
import { writeSettings } from "../src/settings";

/** No real credential store is ever touched by these tests. */
function fakeStore(secret?: string): CredentialStore {
  return {
    backend: "linux-secret-service",
    get: async () => secret,
    set: async () => undefined,
    delete: async () => undefined,
  };
}

let dir: string;
let paths: AppPaths;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bamboohr-config-"));
  paths = resolveAppPaths({ BAMBOOHR_MCP_DATA_DIR: dir }, "linux", dir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("combines the credential store with config.json", async () => {
    writeSettings(paths, { companyDomain: "acme", vacationType: "Puhkus" });
    const config = await loadConfig({ paths, env: {}, store: fakeStore("abc") });
    expect(config.token).toBe("abc");
    expect(config.companyDomain).toBe("acme");
    expect(config.vacationType).toBe("Puhkus");
    expect(config.settings.maxRecords).toBe(25);
    expect(config.paths).toBe(paths);
  });

  it("omits vacationType when unset", async () => {
    writeSettings(paths, { companyDomain: "acme" });
    const config = await loadConfig({ paths, env: {}, store: fakeStore("abc") });
    expect(config.vacationType).toBeUndefined();
  });

  it("takes the subdomain from the environment when set", async () => {
    const config = await loadConfig({ paths, env: { BAMBOOHR_COMPANY_DOMAIN: "other" }, store: fakeStore("abc") });
    expect(config.companyDomain).toBe("other");
  });

  it("never reads the key from the environment", async () => {
    writeSettings(paths, { companyDomain: "acme" });
    const err = await loadConfig({ paths, env: { BAMBOOHR_TOKEN: "env-key" } as NodeJS.ProcessEnv, store: fakeStore() })
      .catch((e) => e);
    expect(err).toBeInstanceOf(NotEnrolledError);
  });

  it("throws NotEnrolledError with the exact enrolment command", async () => {
    writeSettings(paths, { companyDomain: "acme" });
    const err = await loadConfig({ paths, env: {}, store: fakeStore() }).catch((e) => e);
    expect(err).toBeInstanceOf(NotEnrolledError);
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.message).toContain("No BambooHR API key is enrolled on this machine.");
    expect(err.message).toContain(enrolmentCommand());
    expect(err.message).toContain("never written to config files");
  });

  it("treats a blank stored key as not enrolled", async () => {
    writeSettings(paths, { companyDomain: "acme" });
    await expect(loadConfig({ paths, env: {}, store: fakeStore("   ") })).rejects.toBeInstanceOf(NotEnrolledError);
  });

  it("reports a missing subdomain once a key is enrolled", async () => {
    const err = await loadConfig({ paths, env: {}, store: fakeStore("abc") }).catch((e) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect(err).not.toBeInstanceOf(NotEnrolledError);
    expect(err.message).toContain(paths.configFile);
    expect(err.message).toContain("enroll");
  });

  it("rejects a domain that is not a bare subdomain", async () => {
    const err = await loadConfig({
      paths,
      env: { BAMBOOHR_COMPANY_DOMAIN: "acme.bamboohr.com" },
      store: fakeStore("abc"),
    }).catch((e) => e);
    // An invalid override is ignored by readSettings, so this surfaces as "not configured".
    expect(err).toBeInstanceOf(ConfigError);
  });
});

describe("enrolmentCommand", () => {
  it("names this node binary and the installed entry point", () => {
    const command = enrolmentCommand();
    expect(command).toContain(process.execPath);
    expect(enrolmentCommand("win32").startsWith('& "')).toBe(true);
    expect(enrolmentCommand("darwin").startsWith('"')).toBe(true);
    expect(command).toMatch(/index\.js" enroll$/);
  });
});
