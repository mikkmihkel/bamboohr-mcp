import { execFile } from "node:child_process";
import * as fs from "node:fs";
import type { AppPaths } from "./appPaths";

export type CredentialBackend = "macos-keychain" | "windows-dpapi" | "linux-secret-service";

export interface CredentialStore {
  readonly backend: CredentialBackend;
  /** The enrolled API key, or undefined when nothing is enrolled. */
  get(): Promise<string | undefined>;
  set(secret: string): Promise<void>;
  delete(): Promise<void>;
}

export class CredentialStoreError extends Error {
  /** What the user should do about it. */
  hint: string;

  constructor(message: string, hint: string) {
    super(message);
    this.name = "CredentialStoreError";
    this.hint = hint;
  }
}

/**
 * Child-process runner. Always `execFile` with an argument array, never a
 * shell: the secret and the paths must not pass through shell parsing where
 * quoting mistakes turn into command injection. Injectable so the tests can
 * assert what would be executed without a credential store on the machine.
 */
export type ExecFn = (file: string, args: string[], input?: string) => Promise<{ code: number; stdout: string; stderr: string }>;

const EXEC_TIMEOUT_MS = 15_000;

export const SERVICE = "bamboohr-mcp";
export const ACCOUNT = "api-key";

/**
 * Resolve an OS helper to an absolute path when one of the known locations exists, so a
 * "security" or "secret-tool" earlier on PATH cannot stand in for the real tool and collect the
 * API key. Falls back to the bare name (PATH lookup) when none of the candidates is present,
 * because refusing to run at all would be worse than the status quo on unusual installs.
 */
export function toolPath(
  candidates: readonly string[],
  fallback: string,
  exists: (p: string) => boolean = fs.existsSync
): string {
  for (const candidate of candidates) {
    try {
      if (exists(candidate)) return candidate;
    } catch {
      /* an unreadable candidate is simply not a candidate */
    }
  }
  return fallback;
}

const SECURITY_PATHS = ["/usr/bin/security"];
const SECRET_TOOL_PATHS = ["/usr/bin/secret-tool", "/usr/local/bin/secret-tool"];

function powershellPath(env: NodeJS.ProcessEnv): string {
  const root = env.SystemRoot?.trim() || "C:\\Windows";
  return toolPath([`${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`], "powershell");
}

function icaclsPath(env: NodeJS.ProcessEnv): string {
  const root = env.SystemRoot?.trim() || "C:\\Windows";
  return toolPath([`${root}\\System32\\icacls.exe`], "icacls");
}

/** macOS `security` exits 44 when the item does not exist. */
const SECURITY_NOT_FOUND = 44;

const defaultExec: ExecFn = (file, args, input) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { timeout: EXEC_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error && typeof (error as NodeJS.ErrnoException).code !== "number") {
          // Spawn failure (ENOENT) or timeout: there is no exit code to report.
          reject(error);
          return;
        }
        resolve({ code: error ? Number((error as NodeJS.ErrnoException).code) : 0, stdout, stderr });
      }
    );
    // Close stdin even when there is no input, so a tool that would otherwise
    // wait for a terminal prompt fails fast instead of hanging the server.
    child.stdin?.end(input ?? "");
  });

/** Keep a secret out of any message we build from tool output. */
function redact(text: string, secret?: string): string {
  const trimmed = text.trim();
  if (!secret) return trimmed;
  return trimmed.split(secret).join("***");
}

function stripTrailingNewline(text: string): string {
  return text.replace(/\r?\n$/, "");
}

function createMacStore(exec: ExecFn): CredentialStore {
  const hint = "Unlock the login keychain and try again (Keychain Access > login).";
  const security = toolPath(SECURITY_PATHS, "security");
  const run = async (args: string[], input?: string, secret?: string) => {
    try {
      return await exec(security, args, input);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new CredentialStoreError("macOS `security` command not found", "This backend needs the standard macOS command line tools.");
      }
      throw new CredentialStoreError(`macOS keychain call failed: ${redact(err.message, secret)}`, hint);
    }
  };

  return {
    backend: "macos-keychain",
    async get() {
      const { code, stdout, stderr } = await run(["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]);
      if (code === SECURITY_NOT_FOUND) return undefined;
      if (code !== 0) throw new CredentialStoreError(`Cannot read the API key from the keychain: ${redact(stderr)}`, hint);
      const value = stripTrailingNewline(stdout);
      return value === "" ? undefined : value;
    },
    async set(secret) {
      // `security -i` reads its commands from stdin, so the key never becomes an argv entry
      // that every other process on the machine could read out of the process list.
      // The command line it reads is whitespace-separated and understands double quotes, so a
      // key containing whitespace, a quote or a backslash is refused rather than mis-parsed —
      // BambooHR API keys are alphanumeric.
      if (/[\s"\\]/.test(secret)) {
        throw new CredentialStoreError(
          "The API key contains whitespace, a double quote or a backslash and cannot be stored in the macOS keychain",
          "Check the key you pasted: a BambooHR API key is alphanumeric, with no spaces."
        );
      }
      const command = `add-generic-password -U -s ${SERVICE} -a ${ACCOUNT} -w "${secret}"\n`;
      const { code, stderr } = await run(["-i"], command, secret);
      // In interactive mode a failed sub-command reports on stderr; a successful add says nothing.
      if (code !== 0 || stderr.trim() !== "") {
        throw new CredentialStoreError(`Cannot store the API key in the keychain: ${redact(stderr, secret)}`, hint);
      }
    },
    async delete() {
      const { code, stderr } = await run(["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT]);
      if (code === 0 || code === SECURITY_NOT_FOUND) return;
      throw new CredentialStoreError(`Cannot delete the API key from the keychain: ${redact(stderr)}`, hint);
    },
  };
}

/** Single-quote a value for PowerShell (`'` doubles itself inside a literal string). */
function psQuote(value: string): string {
  return `'${value.split("'").join("''")}'`;
}

function createWindowsStore(paths: AppPaths, exec: ExecFn, env: NodeJS.ProcessEnv): CredentialStore {
  const file = paths.credentialFile;
  const hint = "Run the enroll subcommand again from the same Windows account; DPAPI blobs are user- and machine-bound.";
  const powershell = powershellPath(env);
  const runPs = async (script: string, input?: string, secret?: string) => {
    try {
      return await exec(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], input);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new CredentialStoreError("Windows PowerShell not found on PATH", "PowerShell 5.1 or later is required for the DPAPI credential store.");
      }
      throw new CredentialStoreError(`DPAPI call failed: ${redact(err.message, secret)}`, hint);
    }
  };

  return {
    backend: "windows-dpapi",
    async get() {
      if (!fs.existsSync(file)) return undefined;
      const script =
        "$ErrorActionPreference = 'Stop'; " +
        // -LiteralPath: the path must never be read as a wildcard pattern.
        `$enc = Get-Content -Raw -LiteralPath ${psQuote(file)}; ` +
        "$sec = ConvertTo-SecureString -String $enc; " +
        "[Console]::Out.Write([System.Net.NetworkCredential]::new('', $sec).Password)";
      const { code, stdout, stderr } = await runPs(script);
      if (code !== 0) throw new CredentialStoreError(`Cannot decrypt ${file}: ${redact(stderr)}`, hint);
      const value = stripTrailingNewline(stdout);
      return value === "" ? undefined : value;
    },
    async set(secret) {
      fs.mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 });
      // The secret goes in on stdin: a PowerShell argument would be visible in
      // the command line of the process for anything reading the process list.
      const script =
        "$ErrorActionPreference = 'Stop'; " +
        '$s = [Console]::In.ReadToEnd().TrimEnd("`r","`n"); ' +
        "$sec = ConvertTo-SecureString -String $s -AsPlainText -Force; " +
        `ConvertFrom-SecureString -SecureString $sec | Set-Content -NoNewline -LiteralPath ${psQuote(file)}`;
      const { code, stderr } = await runPs(script, secret, secret);
      if (code !== 0) throw new CredentialStoreError(`Cannot store the API key with DPAPI: ${redact(stderr, secret)}`, hint);
      await restrictWindowsAcl(file, exec, env);
    },
    async delete() {
      try {
        fs.unlinkSync(file);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new CredentialStoreError(`Cannot delete ${file}: ${(e as Error).message}`, hint);
        }
      }
    },
  };
}

/** Best effort: drop inherited rights so only this account can read the blob. Never fatal. */
async function restrictWindowsAcl(file: string, exec: ExecFn, env: NodeJS.ProcessEnv): Promise<void> {
  const user = env.USERNAME?.trim();
  if (!user) return;
  try {
    await exec(icaclsPath(env), [file, "/inheritance:r", "/grant:r", `${user}:F`]);
  } catch {
    // The DPAPI blob is already useless to other users; tightening the ACL is a bonus.
  }
}

function createLinuxStore(exec: ExecFn): CredentialStore {
  const missingHint = "install libsecret-tools (Debian/Ubuntu: apt install libsecret-tools; Fedora: dnf install libsecret)";
  const hint = "Make sure a Secret Service provider (GNOME Keyring, KWallet) is running and unlocked.";
  const secretTool = toolPath(SECRET_TOOL_PATHS, "secret-tool");
  const run = async (args: string[], input?: string, secret?: string) => {
    try {
      return await exec(secretTool, args, input);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") throw new CredentialStoreError("`secret-tool` is not installed", missingHint);
      throw new CredentialStoreError(`Secret Service call failed: ${redact(err.message, secret)}`, hint);
    }
  };

  return {
    backend: "linux-secret-service",
    async get() {
      const { code, stdout, stderr } = await run(["lookup", "service", SERVICE, "account", ACCOUNT]);
      const value = stripTrailingNewline(stdout);
      if (code !== 0) {
        // `secret-tool lookup` exits 1 with no output when the item is absent.
        if (value === "") return undefined;
        throw new CredentialStoreError(`Cannot read the API key from the Secret Service: ${redact(stderr)}`, hint);
      }
      return value === "" ? undefined : value;
    },
    async set(secret) {
      // secret-tool reads the secret from stdin, so it never appears in argv.
      const { code, stderr } = await run(
        ["store", `--label=${SERVICE} API key`, "service", SERVICE, "account", ACCOUNT],
        secret,
        secret
      );
      if (code !== 0) throw new CredentialStoreError(`Cannot store the API key in the Secret Service: ${redact(stderr, secret)}`, hint);
    },
    async delete() {
      const { code, stderr } = await run(["clear", "service", SERVICE, "account", ACCOUNT]);
      if (code !== 0) throw new CredentialStoreError(`Cannot delete the API key from the Secret Service: ${redact(stderr)}`, hint);
    },
  };
}

/**
 * The API key lives in the OS credential store and nowhere else: not in the
 * environment (visible to every child process and to Claude Desktop's config
 * file), not in config.json, never in a log line.
 */
export function createCredentialStore(
  paths: AppPaths,
  platform: NodeJS.Platform = process.platform,
  exec: ExecFn = defaultExec,
  env: NodeJS.ProcessEnv = process.env
): CredentialStore {
  if (platform === "darwin") return createMacStore(exec);
  if (platform === "win32") return createWindowsStore(paths, exec, env);
  return createLinuxStore(exec);
}
