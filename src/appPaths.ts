import * as os from "node:os";
import * as path from "node:path";

/**
 * Where the server keeps its per-user state. Nothing here ever holds the API
 * key: the key lives in the OS credential store (see credentialStore.ts), and
 * these files only carry non-secret settings and the audit log.
 */
export interface AppPaths {
  /** Per-user data directory (config.json, audit salt, Windows credential blob). */
  dataDir: string;
  /** Audit log directory. */
  logDir: string;
  /** Non-secret settings file. */
  configFile: string;
  /** Random salt used to hash employee ids in the audit log. */
  saltFile: string;
  /** Windows only: DPAPI-encrypted API key blob. Unused on macOS and Linux. */
  credentialFile: string;
}

const APP = "bamboohr-mcp";

/** Escape hatch for portable installs and for tests, which must never touch the real user directory. */
export const DATA_DIR_ENV = "BAMBOOHR_MCP_DATA_DIR";

function build(dataDir: string, logDir: string): AppPaths {
  return {
    dataDir,
    logDir,
    configFile: path.join(dataDir, "config.json"),
    saltFile: path.join(dataDir, "audit-salt"),
    credentialFile: path.join(dataDir, "credential.dpapi"),
  };
}

/**
 * Resolve the per-OS directories. All arguments are injectable so the tests can
 * check every platform from a single machine.
 *
 * - Windows: `%LOCALAPPDATA%\bamboohr-mcp` — LOCALAPPDATA is deliberately not
 *   roamed and not synced by OneDrive, so the audit log stays on this machine.
 * - macOS: `~/Library/Application Support/bamboohr-mcp` plus the conventional
 *   `~/Library/Logs/bamboohr-mcp` for logs.
 * - Linux and everything else: `$XDG_STATE_HOME/bamboohr-mcp` (state, not cache
 *   or config, because the audit log must survive but is machine-local).
 */
export function resolveAppPaths(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir()
): AppPaths {
  const override = env[DATA_DIR_ENV]?.trim();
  if (override) {
    const dataDir = path.resolve(override);
    return build(dataDir, path.join(dataDir, "logs"));
  }

  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim() || path.join(home, "AppData", "Local");
    const dataDir = path.join(localAppData, APP);
    return build(dataDir, path.join(dataDir, "logs"));
  }

  if (platform === "darwin") {
    return build(path.join(home, "Library", "Application Support", APP), path.join(home, "Library", "Logs", APP));
  }

  const stateHome = env.XDG_STATE_HOME?.trim() || path.join(home, ".local", "state");
  const dataDir = path.join(stateHome, APP);
  return build(dataDir, path.join(dataDir, "logs"));
}
