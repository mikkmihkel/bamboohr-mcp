import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveAppPaths, type AppPaths } from "../src/appPaths";
import { API_KEY_ENV, ConfigError, enrolmentCommand, loadConfig, NotEnrolledError } from "../src/config";
import { CredentialStoreError, type CredentialStore } from "../src/credentialStore";
import { readSettings, writeSettings } from "../src/settings";

/** No real credential store is ever touched by these tests. */
function fakeStore(secret?: string): CredentialStore {
  return {
    backend: "linux-secret-service",
    get: async () => secret,
    set: async () => undefined,
    delete: async () => undefined,
  };
}

/** A store that records what was written to it, the way the real one would be driven. */
function recordingStore(secret?: string) {
  const written: string[] = [];
  const store: CredentialStore = {
    backend: "linux-secret-service",
    get: async () => secret,
    set: async (value) => {
      written.push(value);
      secret = value;
    },
    delete: async () => undefined,
  };
  return { store, written };
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

  it("reads the key from no environment variable other than the one the bundle injects", async () => {
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
    expect(err.message).toContain("No BambooHR API key is available on this machine.");
    expect(err.message).toContain("Settings > Extensions > BambooHR");
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

  it("names the value the user typed when the subdomain is not a bare subdomain", async () => {
    const err = await loadConfig({
      paths,
      env: { [API_KEY_ENV]: "abc", BAMBOOHR_COMPANY_DOMAIN: "https://acme.bamboohr.com" },
      store: fakeStore(),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.message).toContain("https://acme.bamboohr.com");
    expect(err.message).toContain("Settings > Extensions > BambooHR");
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

describe("loadConfig with the key from Claude Desktop", () => {
  const env = { [API_KEY_ENV]: "dialog-key", BAMBOOHR_COMPANY_DOMAIN: "acme" };

  it("uses the key the install dialog supplies when nothing is enrolled", async () => {
    const config = await loadConfig({ paths, env, store: fakeStore() });
    expect(config.token).toBe("dialog-key");
    expect(config.companyDomain).toBe("acme");
    expect(config.warnings).toEqual([]);
  });

  it("copies that key into the OS credential store", async () => {
    const { store, written } = recordingStore();
    await loadConfig({ paths, env, store });
    expect(written).toEqual(["dialog-key"]);
  });

  it("writes the subdomain to config.json so the CLI sees the same install", async () => {
    await loadConfig({ paths, env, store: fakeStore() });
    expect(readSettings(paths, {}).companyDomain).toBe("acme");
  });

  it("overrides a stale enrolled key, so changing it in the dialog takes effect", async () => {
    writeSettings(paths, { companyDomain: "acme" });
    const { store, written } = recordingStore("old-key");
    const config = await loadConfig({ paths, env, store });
    expect(config.token).toBe("dialog-key");
    expect(written).toEqual(["dialog-key"]);
  });

  it("does not rewrite the credential store when it already holds that key", async () => {
    writeSettings(paths, { companyDomain: "acme" });
    const { store, written } = recordingStore("dialog-key");
    await loadConfig({ paths, env, store });
    expect(written).toEqual([]);
  });

  it("still starts when the credential store cannot be written", async () => {
    writeSettings(paths, { companyDomain: "acme" });
    const store: CredentialStore = {
      backend: "macos-keychain",
      get: async () => undefined,
      set: async () => {
        throw new CredentialStoreError("keychain is locked", "Unlock the login keychain.");
      },
      delete: async () => undefined,
    };
    const config = await loadConfig({ paths, env, store });
    expect(config.token).toBe("dialog-key");
    expect(config.warnings.join(" ")).toContain("keychain is locked");
    expect(config.warnings.join(" ")).toContain("Unlock the login keychain.");
  });

  it("still starts when the credential store cannot even be read", async () => {
    writeSettings(paths, { companyDomain: "acme" });
    const { written } = recordingStore();
    const store: CredentialStore = {
      backend: "macos-keychain",
      get: async () => {
        throw new CredentialStoreError("keychain is locked", "Unlock it.");
      },
      set: async (value) => {
        written.push(value);
      },
      delete: async () => undefined,
    };
    const config = await loadConfig({ paths, env, store });
    expect(config.token).toBe("dialog-key");
    expect(written).toEqual(["dialog-key"]);
  });

  it("ignores a blank value from the dialog and falls back to the credential store", async () => {
    writeSettings(paths, { companyDomain: "acme" });
    const { store, written } = recordingStore("enrolled-key");
    const config = await loadConfig({ paths, env: { [API_KEY_ENV]: "   ", BAMBOOHR_COMPANY_DOMAIN: "acme" }, store });
    expect(config.token).toBe("enrolled-key");
    expect(written).toEqual([]);
  });

  it("warns instead of failing when config.json cannot be written", async () => {
    const config = await loadConfig({
      paths,
      env,
      store: fakeStore(),
      writeSettings: () => {
        throw new Error("read-only file system");
      },
    });
    expect(config.token).toBe("dialog-key");
    expect(config.warnings.join(" ")).toContain("read-only file system");
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

  it("sets ELECTRON_RUN_AS_NODE when the runtime is Claude Desktop's helper, not node", () => {
    const helper = "/Applications/Claude.app/Contents/Frameworks/Claude Helper (Plugin).app/Contents/MacOS/Claude Helper (Plugin)";
    // Without the variable the helper starts an app window and ignores the script.
    expect(enrolmentCommand("darwin", helper)).toBe(
      `ELECTRON_RUN_AS_NODE=1 "${helper}" "${path.join(__dirname, "..", "src", "index.js")}" enroll`
    );
    expect(enrolmentCommand("win32", "C:\\Program Files\\Claude\\Claude.exe")).toMatch(
      /^\$env:ELECTRON_RUN_AS_NODE=1; & "/
    );
    expect(enrolmentCommand("darwin", "/usr/local/bin/node").startsWith('"')).toBe(true);
    expect(enrolmentCommand("win32", "C:\\node\\node.exe").startsWith('& "')).toBe(true);
  });
});

describe("an unsubstituted user_config placeholder", () => {
  it("is not taken for a key", async () => {
    writeSettings(paths, { companyDomain: "acme" });
    const { store, written } = recordingStore("enrolled-key");
    const config = await loadConfig({ paths, env: { [API_KEY_ENV]: "${user_config.api_key}" }, store });
    expect(config.token).toBe("enrolled-key");
    expect(written).toEqual([]);
  });

  it("is not taken for a setting", () => {
    writeSettings(paths, { companyDomain: "acme" });
    const settings = readSettings(paths, { BAMBOOHR_VACATION_TYPE: "${user_config.vacation_type}" });
    expect(settings.vacationType).toBeUndefined();
  });
});
