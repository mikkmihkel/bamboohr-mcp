import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAppPaths, type AppPaths } from "../src/appPaths";
import { isSubcommand, runCli, type CliDeps } from "../src/cli";
import { CredentialStoreError, type CredentialStore } from "../src/credentialStore";
import { readSettings } from "../src/settings";

const KEY = "bamboo-api-key-0123456789";

function fakeStore(initial?: string) {
  let secret = initial;
  const store: CredentialStore = {
    backend: "linux-secret-service",
    get: vi.fn(async () => secret),
    set: vi.fn(async (value: string) => {
      secret = value;
    }),
    delete: vi.fn(async () => {
      secret = undefined;
    }),
  };
  return { store, stored: () => secret };
}

function okFetch() {
  return vi.fn(async () =>
    new Response(JSON.stringify({ schemaVersion: 1 }), { status: 200, headers: { "content-type": "application/json" } })
  ) as unknown as typeof fetch;
}

let dir: string;
let paths: AppPaths;
let out: string[];
let err: string[];

function deps(overrides: Partial<CliDeps> = {}): Partial<CliDeps> {
  return {
    paths,
    env: {},
    version: "4.0.0",
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    fetch: okFetch(),
    readRecentEntries: () => [],
    prompt: async () => {
      throw new Error("prompt not expected");
    },
    readStdin: async () => {
      throw new Error("stdin not expected");
    },
    ...overrides,
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bamboohr-cli-"));
  paths = resolveAppPaths({ BAMBOOHR_MCP_DATA_DIR: dir }, "linux", dir);
  out = [];
  err = [];
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("isSubcommand", () => {
  it("knows the subcommands and nothing else", () => {
    for (const c of ["enroll", "unenroll", "status", "logs", "doctor", "version", "--version"]) {
      expect(isSubcommand(c)).toBe(true);
    }
    expect(isSubcommand(undefined)).toBe(false);
    expect(isSubcommand("--stdio")).toBe(false);
  });
});

describe("enroll", () => {
  it("reads the key from stdin and stores it out of the config file", async () => {
    const { store, stored } = fakeStore();
    const code = await runCli(
      ["enroll", "--subdomain", "acme", "--key-stdin"],
      deps({ store, readStdin: async () => `${KEY}\n` })
    );
    expect(code).toBe(0);
    expect(stored()).toBe(KEY);
    expect(store.set).toHaveBeenCalledTimes(1);
    expect(readSettings(paths, {}).companyDomain).toBe("acme");
    expect(fs.readFileSync(paths.configFile, "utf8")).not.toContain(KEY);
    expect(out.join("\n")).not.toContain(KEY);
    expect(out.join("\n")).toContain("linux-secret-service");
    expect(out.join("\n")).toContain(paths.configFile);
  });

  it("prompts for the subdomain and for the key with echo disabled", async () => {
    const { store, stored } = fakeStore();
    const asked: { question: string; secret?: boolean }[] = [];
    const prompt = async (question: string, options: { secret?: boolean } = {}) => {
      asked.push({ question, secret: options.secret });
      return options.secret ? `  ${KEY}  ` : " acme ";
    };
    expect(await runCli(["enroll"], deps({ store, prompt }))).toBe(0);
    expect(asked[0]!.secret).toBeFalsy();
    expect(asked[1]!.secret).toBe(true);
    expect(stored()).toBe(KEY);
    expect(readSettings(paths, {}).companyDomain).toBe("acme");
  });

  it("refuses an empty key without touching the store", async () => {
    const { store } = fakeStore();
    const code = await runCli(["enroll", "--subdomain", "acme", "--key-stdin"], deps({ store, readStdin: async () => "  \n" }));
    expect(code).toBe(2);
    expect(store.set).not.toHaveBeenCalled();
    expect(fs.existsSync(paths.configFile)).toBe(false);
    expect(err.join("\n")).toMatch(/must not be empty/);
  });

  it("refuses a host name in place of a subdomain", async () => {
    const { store } = fakeStore();
    const code = await runCli(["enroll", "--subdomain", "acme.bamboohr.com", "--key-stdin"], deps({ store }));
    expect(code).toBe(2);
    expect(store.set).not.toHaveBeenCalled();
  });

  it("writes the non-secret options it was given", async () => {
    const { store } = fakeStore();
    const code = await runCli(
      [
        "enroll", "--subdomain", "acme", "--key-stdin",
        "--vacation-type", "Puhkus",
        "--max-records", "100",
        "--enable-sensitive-tools",
        "--revocation-url", "https://example.test/r.json",
        "--strict-self-check",
      ],
      deps({ store, readStdin: async () => KEY })
    );
    expect(code).toBe(0);
    expect(readSettings(paths, {})).toMatchObject({
      companyDomain: "acme",
      vacationType: "Puhkus",
      maxRecords: 100,
      enableSensitiveTools: true,
      revocationUrl: "https://example.test/r.json",
      strictSelfCheck: true,
    });
  });

  it("stores a repeatable custom-field allow-list", async () => {
    const { store } = fakeStore();
    const code = await runCli(
      [
        "enroll", "--subdomain", "acme", "--key-stdin",
        "--allow-custom-field", "customShoeSize",
        "--allow-custom-field", "customEquipment",
      ],
      deps({ store, readStdin: async () => KEY })
    );
    expect(code).toBe(0);
    expect(readSettings(paths, {}).allowedCustomFields).toEqual(["customShoeSize", "customEquipment"]);
    expect(out.join("\n")).toContain("custom fields:     customShoeSize, customEquipment");
  });

  it("refuses every custom field with --no-custom-fields", async () => {
    const { store } = fakeStore();
    expect(
      await runCli(["enroll", "--subdomain", "acme", "--key-stdin", "--no-custom-fields"], deps({ store, readStdin: async () => KEY }))
    ).toBe(0);
    expect(readSettings(paths, {}).allowedCustomFields).toEqual([]);
    expect(out.join("\n")).toContain("custom fields:     none");
  });

  it("refuses to combine --no-custom-fields with --allow-custom-field", async () => {
    const { store } = fakeStore();
    const code = await runCli(
      ["enroll", "--subdomain", "acme", "--key-stdin", "--no-custom-fields", "--allow-custom-field", "customShoeSize"],
      deps({ store, readStdin: async () => KEY })
    );
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/mutually exclusive/);
  });

  it("leaves the custom-field rule automatic when neither flag is given", async () => {
    const { store } = fakeStore();
    await runCli(["enroll", "--subdomain", "acme", "--key-stdin"], deps({ store, readStdin: async () => KEY }));
    expect(readSettings(paths, {}).allowedCustomFields).toBeUndefined();
    expect(out.join("\n")).toContain("custom fields:     auto");
  });

  it("rejects an unknown option", async () => {
    const { store } = fakeStore();
    expect(await runCli(["enroll", "--api-key", KEY], deps({ store }))).toBe(2);
    expect(err.join("\n")).toMatch(/unknown option/);
    expect(store.set).not.toHaveBeenCalled();
  });
});

describe("status", () => {
  it("reports an enrolled key without printing it", async () => {
    const { store } = fakeStore(KEY);
    await runCli(["enroll", "--subdomain", "acme", "--key-stdin"], deps({ store, readStdin: async () => KEY }));
    out = [];
    const code = await runCli(["status"], deps({ store }));
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("API key enrolled:  yes");
    expect(text).toContain("credential store:  linux-secret-service");
    expect(text).toContain(paths.configFile);
    expect(text).toContain(paths.logDir);
    expect(text).toContain("company domain:    acme");
    expect(text).toContain("custom fields:     auto");
    expect(text).toContain("4.0.0");
    expect(text).not.toContain(KEY);
  });

  it("exits 2 when nothing is enrolled", async () => {
    const { store } = fakeStore();
    expect(await runCli(["status"], deps({ store }))).toBe(2);
    expect(out.join("\n")).toContain("API key enrolled:  no");
  });

  it("survives a broken credential store", async () => {
    const { store } = fakeStore();
    store.get = vi.fn(async () => {
      throw new CredentialStoreError("Secret Service call failed", "unlock the keyring");
    });
    expect(await runCli(["status"], deps({ store }))).toBe(2);
    expect(err.join("\n")).toMatch(/unlock the keyring/);
  });
});

describe("unenroll", () => {
  it("deletes the key and keeps the settings", async () => {
    const { store, stored } = fakeStore();
    await runCli(["enroll", "--subdomain", "acme", "--key-stdin"], deps({ store, readStdin: async () => KEY }));
    out = [];
    expect(await runCli(["unenroll"], deps({ store }))).toBe(0);
    expect(store.delete).toHaveBeenCalledTimes(1);
    expect(stored()).toBeUndefined();
    expect(readSettings(paths, {}).companyDomain).toBe("acme");
    expect(out.join("\n")).toContain("Settings in");
  });
});

describe("logs", () => {
  const entries = [
    { ts: "2026-09-20T10:00:00.000Z", tool: "whos_out", outcome: "ok", recordCount: 3 },
    { ts: "2026-09-20T10:01:00.000Z", tool: "get_employee", outcome: "rejected", error: "PolicyError" },
  ];

  it("prints the log directory and one JSON line per entry", async () => {
    const readRecentEntries = vi.fn(() => entries);
    expect(await runCli(["logs"], deps({ readRecentEntries }))).toBe(0);
    expect(readRecentEntries).toHaveBeenCalledWith(paths.logDir, 50);
    expect(out[0]).toBe(`Audit log directory: ${paths.logDir}`);
    expect(out.slice(1)).toEqual(entries.map((e) => JSON.stringify(e)));
  });

  it("honours --tail", async () => {
    const readRecentEntries = vi.fn(() => []);
    expect(await runCli(["logs", "--tail", "5"], deps({ readRecentEntries }))).toBe(0);
    expect(readRecentEntries).toHaveBeenCalledWith(paths.logDir, 5);
  });

  it("rejects a nonsense --tail", async () => {
    expect(await runCli(["logs", "--tail", "zero"], deps())).toBe(2);
    expect(err.join("\n")).toMatch(/positive whole number/);
  });
});

describe("doctor", () => {
  it("passes once the machine is enrolled and the version is not revoked", async () => {
    const { store } = fakeStore();
    await runCli(["enroll", "--subdomain", "acme", "--key-stdin"], deps({ store, readStdin: async () => KEY }));
    out = [];
    const code = await runCli(["doctor"], deps({ store }));
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("[ok]   company subdomain: acme");
    expect(text).toContain("[ok]   API key enrolled in linux-secret-service");
    expect(text).toContain("[ok]   self-check");
  });

  it("reports the missing pieces without connecting to BambooHR", async () => {
    const { store } = fakeStore();
    const code = await runCli(["doctor"], deps({ store }));
    expect(code).toBe(2);
    const text = out.join("\n");
    expect(text).toContain("[fail] no company subdomain configured");
    expect(text).toContain("[fail] no API key");
  });

  it("exits 3 when this version is revoked", async () => {
    const { store } = fakeStore(KEY);
    await runCli(["enroll", "--subdomain", "acme", "--key-stdin"], deps({ store, readStdin: async () => KEY }));
    out = [];
    const revoking = vi.fn(async () =>
      new Response(JSON.stringify({ schemaVersion: 1, revokedVersions: ["4.0.0"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    ) as unknown as typeof fetch;
    expect(await runCli(["doctor"], deps({ store, fetch: revoking }))).toBe(3);
    expect(out.join("\n")).toContain("[fail] self-check");
  });

  it("only warns about an unreachable endpoint unless strict self-check is on", async () => {
    const { store } = fakeStore(KEY);
    await runCli(["enroll", "--subdomain", "acme", "--key-stdin"], deps({ store, readStdin: async () => KEY }));
    const offline = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as typeof fetch;
    out = [];
    expect(await runCli(["doctor"], deps({ store, fetch: offline }))).toBe(0);
    expect(out.join("\n")).toContain("[warn] self-check");

    await runCli(["enroll", "--subdomain", "acme", "--key-stdin", "--strict-self-check"], deps({ store, readStdin: async () => KEY }));
    out = [];
    expect(await runCli(["doctor"], deps({ store, fetch: offline }))).toBe(2);
    expect(out.join("\n")).toContain("[fail] self-check");
  });
});

describe("version and usage", () => {
  it("prints the version", async () => {
    expect(await runCli(["--version"], deps())).toBe(0);
    expect(out).toEqual(["4.0.0"]);
  });

  it("prints usage for anything else", async () => {
    expect(await runCli(["frobnicate"], deps())).toBe(2);
    expect(err.join("\n")).toContain("Usage:");
    expect(err.join("\n")).toContain("--key-stdin");
  });
});
