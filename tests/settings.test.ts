import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveAppPaths, type AppPaths } from "../src/appPaths";
import { DEFAULT_REVOCATION_URL, readSettings, SettingsError, writeSettings } from "../src/settings";

let dir: string;
let paths: AppPaths;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bamboohr-settings-"));
  paths = resolveAppPaths({ BAMBOOHR_MCP_DATA_DIR: dir }, "linux", dir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeRaw(value: unknown): void {
  fs.mkdirSync(path.dirname(paths.configFile), { recursive: true });
  fs.writeFileSync(paths.configFile, JSON.stringify(value));
}

describe("readSettings", () => {
  it("returns defaults when no config file exists", () => {
    expect(readSettings(paths, {})).toEqual({
      enableSensitiveTools: false,
      maxRecords: 25,
      strictSelfCheck: false,
      revocationUrl: DEFAULT_REVOCATION_URL,
    });
  });

  it("reads the config file", () => {
    writeRaw({ companyDomain: "acme", vacationType: "Puhkus", enableSensitiveTools: true, maxRecords: 100, strictSelfCheck: true });
    expect(readSettings(paths, {})).toMatchObject({
      companyDomain: "acme",
      vacationType: "Puhkus",
      enableSensitiveTools: true,
      maxRecords: 100,
      strictSelfCheck: true,
    });
  });

  it("lets non-secret env variables override the file", () => {
    writeRaw({ companyDomain: "acme", maxRecords: 10 });
    const settings = readSettings(paths, {
      BAMBOOHR_COMPANY_DOMAIN: "other",
      BAMBOOHR_VACATION_TYPE: "Vacation",
      BAMBOOHR_ENABLE_SENSITIVE_TOOLS: "true",
      BAMBOOHR_MAX_RECORDS: "42",
      BAMBOOHR_REVOCATION_URL: "https://example.test/r.json",
      BAMBOOHR_STRICT_SELF_CHECK: "1",
    });
    expect(settings).toEqual({
      companyDomain: "other",
      vacationType: "Vacation",
      enableSensitiveTools: true,
      maxRecords: 42,
      revocationUrl: "https://example.test/r.json",
      strictSelfCheck: true,
    });
  });

  it("never exposes an API key from the file or the environment", () => {
    writeRaw({ companyDomain: "acme", token: "file-key", apiKey: "file-key" });
    const settings = readSettings(paths, { BAMBOOHR_TOKEN: "env-key" } as NodeJS.ProcessEnv);
    expect(JSON.stringify(settings)).not.toContain("key");
  });

  it("ignores invalid values instead of failing to start", () => {
    writeRaw({ companyDomain: "acme.bamboohr.com", maxRecords: 5000, enableSensitiveTools: "maybe" });
    const settings = readSettings(paths, {});
    expect(settings.companyDomain).toBeUndefined();
    expect(settings.maxRecords).toBe(25);
    expect(settings.enableSensitiveTools).toBe(false);
  });

  it("reports an unreadable config file", () => {
    fs.mkdirSync(path.dirname(paths.configFile), { recursive: true });
    fs.writeFileSync(paths.configFile, "{ not json");
    expect(() => readSettings(paths, {})).toThrow(SettingsError);
  });
});

describe("writeSettings", () => {
  it("creates the file 0600 inside a 0700 directory", () => {
    writeSettings(paths, { companyDomain: "acme" });
    expect(fs.statSync(paths.configFile).mode & 0o777).toBe(0o600);
    expect(fs.statSync(paths.dataDir).mode & 0o777).toBe(0o700);
    expect(readSettings(paths, {}).companyDomain).toBe("acme");
  });

  it("merges into the existing file and keeps it 0600", () => {
    writeSettings(paths, { companyDomain: "acme", maxRecords: 50 });
    writeSettings(paths, { vacationType: "Puhkus" });
    const settings = readSettings(paths, {});
    expect(settings).toMatchObject({ companyDomain: "acme", maxRecords: 50, vacationType: "Puhkus" });
    expect(fs.statSync(paths.configFile).mode & 0o777).toBe(0o600);
  });

  it("merges against the file, not against environment overrides", () => {
    writeSettings(paths, { companyDomain: "acme" });
    writeSettings(paths, { vacationType: "Puhkus" });
    expect(JSON.parse(fs.readFileSync(paths.configFile, "utf8"))).toEqual({ companyDomain: "acme", vacationType: "Puhkus" });
  });

  it("rejects a domain that is not a bare subdomain", () => {
    expect(() => writeSettings(paths, { companyDomain: "acme.bamboohr.com" })).toThrow(/subdomain/);
  });

  it("rejects an out-of-range record cap and a non-https revocation url", () => {
    expect(() => writeSettings(paths, { maxRecords: 0 })).toThrow(SettingsError);
    expect(() => writeSettings(paths, { maxRecords: 501 })).toThrow(SettingsError);
    expect(() => writeSettings(paths, { revocationUrl: "http://example.test/r.json" })).toThrow(/https/);
  });
});
