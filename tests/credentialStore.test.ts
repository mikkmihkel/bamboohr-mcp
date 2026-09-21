import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveAppPaths, type AppPaths } from "../src/appPaths";
import { createCredentialStore, CredentialStoreError, toolPath, type ExecFn } from "../src/credentialStore";

const SECRET = "bamboo-api-key-0123456789";

interface Call {
  file: string;
  args: string[];
  input?: string;
}

interface Result {
  code?: number;
  stdout?: string;
  stderr?: string;
  throws?: NodeJS.ErrnoException;
}

function fakeExec(results: Result[]): { exec: ExecFn; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const exec: ExecFn = async (file, args, input) => {
    calls.push({ file, args, input });
    const result = results[i] ?? {};
    i += 1;
    if (result.throws) throw result.throws;
    return { code: result.code ?? 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
  return { exec, calls };
}

let dir: string;
let paths: AppPaths;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bamboohr-cred-"));
  paths = resolveAppPaths({ BAMBOOHR_MCP_DATA_DIR: dir }, "linux", dir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("toolPath", () => {
  it("returns the first candidate that exists", () => {
    const exists = (p: string) => p === "/usr/local/bin/secret-tool";
    expect(toolPath(["/usr/bin/secret-tool", "/usr/local/bin/secret-tool"], "secret-tool", exists)).toBe(
      "/usr/local/bin/secret-tool"
    );
  });

  it("falls back to the bare name when no candidate exists", () => {
    expect(toolPath(["/nope/security"], "security", () => false)).toBe("security");
  });

  it("treats a candidate that cannot be tested as absent", () => {
    expect(
      toolPath(["/nope/security"], "security", () => {
        throw new Error("EACCES");
      })
    ).toBe("security");
  });
});

describe("macOS keychain backend", () => {
  it("stores the secret on stdin with `security -i`, never in argv", async () => {
    const { exec, calls } = fakeExec([{}]);
    const store = createCredentialStore(paths, "darwin", exec);
    expect(store.backend).toBe("macos-keychain");
    await store.set(SECRET);
    // An argv entry is readable from the process list by every other process on the machine.
    expect(calls[0]!.file).toMatch(/(^|\/)security$/);
    expect(calls[0]!.args).toEqual(["-i"]);
    expect(calls[0]!.args.join(" ")).not.toContain(SECRET);
    expect(calls[0]!.input).toBe(`add-generic-password -U -s bamboohr-mcp -a api-key -w "${SECRET}"\n`);
  });

  it("refuses a key that the interactive command line cannot carry safely", async () => {
    for (const bad of ['key with space', 'key"quote', "key\\backslash"]) {
      const { exec, calls } = fakeExec([{}]);
      const err = await createCredentialStore(paths, "darwin", exec).set(bad).catch((e) => e);
      expect(err).toBeInstanceOf(CredentialStoreError);
      expect(err.message).not.toContain(bad);
      expect(calls).toHaveLength(0);
    }
  });

  it("treats output on stderr as a failed store even when the exit code is 0", async () => {
    const { exec } = fakeExec([{ code: 0, stderr: "security: SecKeychainItemCreateFromContent failed" }]);
    const err = await createCredentialStore(paths, "darwin", exec).set(SECRET).catch((e) => e);
    expect(err).toBeInstanceOf(CredentialStoreError);
    expect(err.message).toMatch(/Cannot store the API key/);
  });

  it("reads the key and strips the trailing newline", async () => {
    const { exec, calls } = fakeExec([{ stdout: `${SECRET}\n` }]);
    await expect(createCredentialStore(paths, "darwin", exec).get()).resolves.toBe(SECRET);
    expect(calls[0]!.args).toEqual(["find-generic-password", "-s", "bamboohr-mcp", "-a", "api-key", "-w"]);
  });

  it("maps exit code 44 to 'nothing enrolled'", async () => {
    const { exec } = fakeExec([{ code: 44 }]);
    await expect(createCredentialStore(paths, "darwin", exec).get()).resolves.toBeUndefined();
  });

  it("does not treat a missing item as a failed delete", async () => {
    const { exec } = fakeExec([{ code: 44 }]);
    await expect(createCredentialStore(paths, "darwin", exec).delete()).resolves.toBeUndefined();
  });

  it("reports other failures as CredentialStoreError with a hint", async () => {
    const { exec } = fakeExec([{ code: 1, stderr: "keychain locked" }]);
    const err = await createCredentialStore(paths, "darwin", exec).get().catch((e) => e);
    expect(err).toBeInstanceOf(CredentialStoreError);
    expect(err.hint).toMatch(/keychain/i);
  });
});

describe("Linux Secret Service backend", () => {
  it("passes the secret on stdin, never as an argument", async () => {
    const { exec, calls } = fakeExec([{}]);
    const store = createCredentialStore(paths, "linux", exec);
    expect(store.backend).toBe("linux-secret-service");
    await store.set(SECRET);
    expect(calls[0]!.file).toMatch(/(^|\/)secret-tool$/);
    expect(calls[0]!.args).toEqual([
      "store", "--label=bamboohr-mcp API key", "service", "bamboohr-mcp", "account", "api-key",
    ]);
    expect(calls[0]!.input).toBe(SECRET);
    expect(calls[0]!.args.join(" ")).not.toContain(SECRET);
  });

  it("looks the key up", async () => {
    const { exec, calls } = fakeExec([{ stdout: SECRET }]);
    await expect(createCredentialStore(paths, "linux", exec).get()).resolves.toBe(SECRET);
    expect(calls[0]!.args).toEqual(["lookup", "service", "bamboohr-mcp", "account", "api-key"]);
  });

  it("treats exit 1 with empty output as 'nothing enrolled'", async () => {
    const { exec } = fakeExec([{ code: 1, stdout: "" }]);
    await expect(createCredentialStore(paths, "linux", exec).get()).resolves.toBeUndefined();
  });

  it("clears the key", async () => {
    const { exec, calls } = fakeExec([{}]);
    await createCredentialStore(paths, "linux", exec).delete();
    expect(calls[0]!.args).toEqual(["clear", "service", "bamboohr-mcp", "account", "api-key"]);
  });

  it("explains how to install secret-tool when it is missing", async () => {
    const enoent: NodeJS.ErrnoException = Object.assign(new Error("spawn secret-tool ENOENT"), { code: "ENOENT" });
    const { exec } = fakeExec([{ throws: enoent }]);
    const err = await createCredentialStore(paths, "linux", exec).get().catch((e) => e);
    expect(err).toBeInstanceOf(CredentialStoreError);
    expect(err.hint).toMatch(/libsecret-tools/);
  });

  it("never repeats the secret in an error message", async () => {
    const { exec } = fakeExec([{ code: 1, stderr: `failed to store ${SECRET}` }]);
    const err = await createCredentialStore(paths, "linux", exec).set(SECRET).catch((e) => e);
    expect(err.message).not.toContain(SECRET);
    expect(err.message).toContain("***");
  });
});

describe("Windows DPAPI backend", () => {
  const env = { USERNAME: "anna" } as NodeJS.ProcessEnv;

  it("encrypts through PowerShell with the secret on stdin and tightens the ACL", async () => {
    const { exec, calls } = fakeExec([{}, {}]);
    const store = createCredentialStore(paths, "win32", exec, env);
    expect(store.backend).toBe("windows-dpapi");
    await store.set(SECRET);
    expect(calls[0]!.file).toMatch(/(^|[\\/])powershell(\.exe)?$/i);
    expect(calls[0]!.args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-Command"]);
    expect(calls[0]!.args[3]).toContain("ConvertFrom-SecureString");
    expect(calls[0]!.args[3]).toContain(paths.credentialFile);
    // -LiteralPath: a path with [ ] in it must not be read as a wildcard pattern.
    expect(calls[0]!.args[3]).toContain("-LiteralPath");
    expect(calls[0]!.args[3]).not.toMatch(/-Path /);
    expect(calls[0]!.args.join(" ")).not.toContain(SECRET);
    expect(calls[0]!.input).toBe(SECRET);
    expect(calls[1]!.file).toMatch(/(^|[\\/])icacls(\.exe)?$/i);
    expect(calls[1]!.args).toEqual([paths.credentialFile, "/inheritance:r", "/grant:r", "anna:F"]);
  });

  it("returns undefined when no blob has been written", async () => {
    const { exec, calls } = fakeExec([]);
    await expect(createCredentialStore(paths, "win32", exec, env).get()).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("decrypts an existing blob", async () => {
    fs.mkdirSync(paths.dataDir, { recursive: true });
    fs.writeFileSync(paths.credentialFile, "01000000d08c9d");
    const { exec, calls } = fakeExec([{ stdout: SECRET }]);
    await expect(createCredentialStore(paths, "win32", exec, env).get()).resolves.toBe(SECRET);
    expect(calls[0]!.args[3]).toContain("ConvertTo-SecureString");
    expect(calls[0]!.args[3]).toContain("-LiteralPath");
    expect(calls[0]!.args[3]).not.toMatch(/-Path /);
  });

  it("deletes the blob and tolerates it being gone", async () => {
    fs.mkdirSync(paths.dataDir, { recursive: true });
    fs.writeFileSync(paths.credentialFile, "blob");
    const { exec } = fakeExec([]);
    const store = createCredentialStore(paths, "win32", exec, env);
    await store.delete();
    expect(fs.existsSync(paths.credentialFile)).toBe(false);
    await expect(store.delete()).resolves.toBeUndefined();
  });
});
