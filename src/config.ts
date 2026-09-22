import * as path from "node:path";
import { resolveAppPaths, type AppPaths } from "./appPaths";
import { createCredentialStore, CredentialStoreError, type CredentialStore } from "./credentialStore";
import {
  isUnsubstitutedPlaceholder,
  readSettings,
  SUBDOMAIN_RE,
  writeSettings as writeSettingsImpl,
  type Settings,
} from "./settings";

export interface Config {
  token: string;
  companyDomain: string;
  vacationType?: string;
  settings: Settings;
  paths: AppPaths;
  /** Non-fatal problems worth printing once at start-up. Never contains the key. */
  warnings: string[];
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** No API key anywhere. The server still starts; every tool call reports this. */
export class NotEnrolledError extends ConfigError {
  constructor(message: string) {
    super(message);
    this.name = "NotEnrolledError";
  }
}

/**
 * The only environment variable that may carry the API key. The .mcpb manifest
 * declares the key as a `sensitive` user_config field: Claude Desktop asks for
 * it in the install dialog, keeps it in the operating system credential store
 * it manages itself, and hands it to this process — and only this process — in
 * the environment. It is still never read from a config file, a tool argument
 * or any other variable name.
 */
export const API_KEY_ENV = "BAMBOOHR_API_KEY";

/** Where the user sets the key and subdomain when the connector runs under Claude Desktop. */
export const DESKTOP_SETTINGS_HINT =
  "In Claude Desktop, open Settings > Extensions > BambooHR and fill in the API key and the company subdomain.";

/**
 * The exact command the user has to run to enrol from a terminal. `__dirname`
 * resolves to the installed location (dist/, or the unpacked .mcpb directory),
 * so the hint works no matter where Claude Desktop put the bundle.
 *
 * Claude Desktop runs bundles with its own runtime, so `process.execPath` is
 * then an Electron helper rather than `node`. Started from a shell, that helper
 * launches an app and ignores the script unless ELECTRON_RUN_AS_NODE is set, so
 * the printed command has to carry the variable or it simply does nothing.
 */
export function enrolmentCommand(
  platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath
): string {
  const entryPoint = path.join(__dirname, "index.js");
  // Split on both separators rather than path.basename, which only understands
  // the separator of the platform this process happens to run on.
  const base = execPath.split(/[\\/]/).pop()?.toLowerCase();
  const isPlainNode = base === "node" || base === "node.exe";
  if (platform === "win32") {
    // PowerShell parses a line that starts with a quoted path as a string
    // expression, so the call operator is needed for the command to run.
    const prefix = isPlainNode ? "" : "$env:ELECTRON_RUN_AS_NODE=1; ";
    return `${prefix}& "${execPath}" "${entryPoint}" enroll`;
  }
  const prefix = isPlainNode ? "" : "ELECTRON_RUN_AS_NODE=1 ";
  return `${prefix}"${execPath}" "${entryPoint}" enroll`;
}

export interface LoadConfigDeps {
  env?: NodeJS.ProcessEnv;
  paths?: AppPaths;
  store?: CredentialStore;
  /** Injected by the tests; the server always writes the real config.json. */
  writeSettings?: (paths: AppPaths, patch: Partial<Settings>) => void;
}

/**
 * Resolve the runtime configuration: non-secret settings from config.json plus
 * environment overrides, and the API key from Claude Desktop's install dialog
 * or, failing that, from this machine's OS credential store.
 */
export async function loadConfig(deps: LoadConfigDeps = {}): Promise<Config> {
  const env = deps.env ?? process.env;
  const paths = deps.paths ?? resolveAppPaths(env);
  const settings = readSettings(paths, env);
  const store = deps.store ?? createCredentialStore(paths);
  const writeSettings = deps.writeSettings ?? writeSettingsImpl;
  const warnings: string[] = [];

  // The dialog wins over the credential store, so changing the key in Claude
  // Desktop takes effect on the next start instead of being shadowed.
  const raw = env[API_KEY_ENV]?.trim();
  const envKey = raw && !isUnsubstitutedPlaceholder(raw) ? raw : undefined;
  const token = envKey || (await store.get())?.trim();
  if (!token) {
    throw new NotEnrolledError(
      `No BambooHR API key is available on this machine. ${DESKTOP_SETTINGS_HINT}` +
        ` Outside Claude Desktop, run: ${enrolmentCommand()}` +
        "  — the key is kept in the OS credential store and is never written to config files."
    );
  }
  if (envKey) await cacheKey(store, envKey, warnings);

  const companyDomain = settings.companyDomain;
  if (!companyDomain) {
    // readSettings drops a malformed override, so say what was rejected rather
    // than claiming nothing was configured.
    const rejected = env.BAMBOOHR_COMPANY_DOMAIN?.trim();
    if (rejected) {
      throw new ConfigError(
        `"${rejected}" is not a bare BambooHR subdomain. Use the first part of the address only — "acme" for acme.bamboohr.com. ${DESKTOP_SETTINGS_HINT}`
      );
    }
    throw new ConfigError(
      `No BambooHR company subdomain is configured in ${paths.configFile}. ${DESKTOP_SETTINGS_HINT}` +
        ` Outside Claude Desktop, run: ${enrolmentCommand()}`
    );
  }
  if (!SUBDOMAIN_RE.test(companyDomain)) {
    throw new ConfigError(
      `companyDomain must be the bare subdomain (e.g. "acme" for acme.bamboohr.com), got "${companyDomain}"`
    );
  }
  if (envKey) cacheDomain(paths, companyDomain, writeSettings, warnings);

  const config: Config = { token, companyDomain, settings, paths, warnings };
  if (settings.vacationType) config.vacationType = settings.vacationType;
  return config;
}

/**
 * Mirror a key that came from the install dialog into our own credential store.
 * Claude Desktop re-supplies it on every launch, but `status`, `doctor` and a
 * plain `node dist/index.js` run only look here, so one pass through the dialog
 * should be enough for both. Best effort: a locked keyring must never stop a
 * start that already holds the key.
 */
async function cacheKey(store: CredentialStore, token: string, warnings: string[]): Promise<void> {
  let stored: string | undefined;
  try {
    stored = (await store.get())?.trim();
  } catch {
    // Unreadable is not the same as absent; fall through and try to write.
  }
  if (stored === token) return;
  try {
    await store.set(token);
  } catch (e) {
    const hint = e instanceof CredentialStoreError ? ` ${e.hint}` : "";
    warnings.push(
      `the API key could not be saved to the OS credential store: ${(e as Error).message}.${hint}` +
        " The connector still works; the status and doctor commands will report it as not enrolled."
    );
  }
}

/** Same idea for the non-secret subdomain, so the CLI reports the install the user actually has. */
function cacheDomain(
  paths: AppPaths,
  companyDomain: string,
  writeSettings: (paths: AppPaths, patch: Partial<Settings>) => void,
  warnings: string[]
): void {
  // Compare against the file alone, never against the environment layer on top of it.
  if (readSettings(paths, {}).companyDomain === companyDomain) return;
  try {
    writeSettings(paths, { companyDomain });
  } catch (e) {
    warnings.push(`the company subdomain could not be saved to ${paths.configFile}: ${(e as Error).message}`);
  }
}
